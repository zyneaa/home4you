import json
from datetime import datetime
from parameters import *
import random
import numpy as np
from haversine import haversine

def build_user_vector(interactions, properties):
    prop_map = {p['id']: p for p in properties}

    # [Condo, House, Apartment, Land, Material, Construction, Rent, Buy, None, <500k, 500k-2M, >2M]
    user_vec = np.array([0.0] * 12)

    for event in interactions:
        p = prop_map.get(event['listing_id'])
        if not p: continue

        w = event['weight']

        # Property type (6D)
        if p['property_type'] == 'condo':          user_vec[0] += w
        elif p['property_type'] == 'house':        user_vec[1] += w
        elif p['property_type'] == 'apartment':    user_vec[2] += w
        elif p['property_type'] == 'land':         user_vec[3] += w
        elif p['property_type'] == 'material':     user_vec[4] += w
        elif p['property_type'] == 'construction': user_vec[5] += w

        # Transaction type (3D)
        if p['transaction_type'] == 'rent':        user_vec[6] += w
        elif p['transaction_type'] == 'buy':       user_vec[7] += w
        elif p['transaction_type'] == 'none':      user_vec[8] += w

        # Price buckets (3D)
        price = p['price']
        if price == 0:
            # Non-transactional or free items don't contribute to price preference
            pass
        elif price < 500_000:
            user_vec[9] += w
        elif price < 2_000_000:
            user_vec[10] += w
        else:
            user_vec[11] += w

    norm = np.linalg.norm(user_vec)
    return user_vec / norm if norm > 0 else user_vec

def build_property_vector(p):
    # Price buckets (3D)
    price = p['price']
    if price == 0:
        price_vec = [0.0, 0.0, 0.0]
    elif price < 500_000:
        price_vec = [1.0, 0.0, 0.0]
    elif price < 2_000_000:
        price_vec = [0.0, 1.0, 0.0]
    else:
        price_vec = [0.0, 0.0, 1.0]

    vec = np.array([
        # Property type (6D)
        1.0 if p['property_type'] == 'condo' else 0.0,
        1.0 if p['property_type'] == 'house' else 0.0,
        1.0 if p['property_type'] == 'apartment' else 0.0,
        1.0 if p['property_type'] == 'land' else 0.0,
        1.0 if p['property_type'] == 'material' else 0.0,
        1.0 if p['property_type'] == 'construction' else 0.0,

        # Transaction type (3D)
        1.0 if p['transaction_type'] == 'rent' else 0.0,
        1.0 if p['transaction_type'] == 'buy' else 0.0,
        1.0 if p['transaction_type'] == 'none' else 0.0,
    ] + price_vec)

    norm = np.linalg.norm(vec)
    return vec / norm if norm > 0 else vec

def build_session_context(interactions):
    if not interactions:
        return {"dominant_type": None, "dominant_trans": None}
    last_session = interactions[-1]["session_number"]
    recent = [e for e in interactions if e["session_number"] == last_session]

    type_counts = {}
    trans_counts = {}

    for e in recent:
        type_counts[e["property_type"]] = type_counts.get(e["property_type"], 0) + 1
        trans_counts[e["transaction_type"]] = trans_counts.get(e["transaction_type"], 0) + 1

    dominant_type = max(type_counts, key=lambda k: type_counts[k], default=None)
    dominant_trans = max(trans_counts, key=lambda k: trans_counts[k], default=None)

    return {
        "dominant_type": dominant_type,
        "dominant_trans": dominant_trans
    }

def compute_match_score(event, session_ctx):
    score = 0.0
    weight_sum = 0.0

    # Match dominant property type
    weight = 0.5
    if event["property_type"] == session_ctx["dominant_type"]:
        score += weight
    weight_sum += weight

    # Match dominant transaction type
    weight = 0.3
    if event["transaction_type"] == session_ctx["dominant_trans"]:
        score += weight
    weight_sum += weight

    # Fallback/Recency
    weight = 0.2
    score += weight * 0.5 
    weight_sum += weight

    return score / weight_sum

def compute_alpha_beta(interaction_count):
    beta = min(BETA_MAX, interaction_count / K_THRESHOLD)
    alpha = 1.0 - beta
    return alpha, beta

def compute_distance_score(t_lat, t_lng, p_lat, p_lng):
    d = haversine((t_lat, t_lng), (p_lat, p_lng))
    return np.exp(-d / R_COMFORT_ZONE)

def compute_di(dwell_time, activity_factor):
    # Cap activity factor for stability
    capped_activity = min(5.0, max(0.1, activity_factor))
    return np.log(np.e + (dwell_time * capped_activity))

def compute_relevance_final(explicit, implicit, session_intent, alpha, beta):
    base_relevance = (alpha * explicit) + (beta * implicit)
    return (base_relevance * (1 - GAMMA_SESSION_WEIGHT)) + (session_intent * GAMMA_SESSION_WEIGHT)

def compute_freshness(post_age_hours):
    lam_eff = max(LAMBDA_BASE - LAMBDA_USER_RESISTANCE, FRESHNESS_FLOOR)
    return np.exp(-lam_eff * post_age_hours)

def compute_B(authority, boost=0):
    compliance = authority["compliance_score"]
    if compliance < COMPLIANCE_FLOOR:
        compliance *= 0.1 # Penalty for low compliance

    P_recent = authority["posts_per_day"] * min(authority["streak_days"], 30)
    activity = PHI_REACH_CEILING * np.log(1 + P_recent * SIGMA_GRIND_FACTOR)

    return compliance + activity + boost

def compute_raw_rank_score(relevance_final, freshness, b, post_age_hours):
    score_raw = (relevance_final * freshness) + b
    if post_age_hours < T_NEW_WINDOW:
        score_raw += COLD_START_BONUS
    return score_raw

def apply_anti_bubble(score, epsilon):
    exploration_score = random.uniform(0, 1)
    return (score * (1.0 - epsilon)) + (exploration_score * epsilon)

def apply_diversity_penalty(results):
    seen_categories = {}
    for res in results:
        cat = res["property_type"]
        n = seen_categories.get(cat, 0)
        # Apply penalty to the raw score
        res["score_before_log"] *= (GAMMA_DIVERSITY_FACTOR ** n)
        seen_categories[cat] = n + 1

    # Calculate log score after diversity penalty
    for res in results:
        res["final_score_log"] = np.log(1 + res["score_before_log"])

    return sorted(results, key=lambda x: x["final_score_log"], reverse=True)

def percentile_normalize(results):
    scores = [r["final_score_log"] for r in results]
    sorted_scores = sorted(scores)

    sorted_scores = sorted(scores)
    for r in results:
        rank = sum(s <= r["final_score_log"] for s in sorted_scores) - 1
        r["norm_score"] = rank / (len(scores) - 1)

    return results

def run_sunfire_pipeline(log_path, property_path):
    with open(log_path, "r") as f:
        data = json.load(f)
        profile = data["user_profile"]
        interactions = data["interactions"]
    with open(property_path, "r") as f:
        properties = json.load(f)

    now = datetime.now()
    prop_map = {p["id"]: p for p in properties}

    interaction_count = len(interactions)
    alpha, beta = compute_alpha_beta(interaction_count)
    user_vec = build_user_vector(interactions, properties)
    session_ctx = build_session_context(interactions)

    implicit_map = {p["id"]: 0.0 for p in properties}
    session_map = {p["id"]: 0.0 for p in properties}

    for event in interactions:
        pid = event["listing_id"]
        if pid not in prop_map: continue
        dt = (now - datetime.fromisoformat(event["timestamp"])).total_seconds() / 3600
        d_i = compute_di(event["dwell_time_sec"], event["activity_factor"])

        implicit_map[pid] += event["weight"] * d_i * np.exp(-LAMBDA_HISTORICAL * dt)
        match_score = compute_match_score(event, session_ctx) 
        session_map[pid] += event["weight"] * match_score * d_i * np.exp(-LAMBDA_SESSION * dt)

    results = []
    epsilon = EPSILON_NEW_USER if interaction_count < 20 else EPSILON_OLD_USER

    for p in properties:
        pid = p["id"]
        p_vec = build_property_vector(p)
        post_age = (now - datetime.fromisoformat(p["created_at"])).total_seconds() / 3600

        explicit = np.dot(user_vec, p_vec) * compute_distance_score(profile["target_lat"], profile["target_lng"], p["lat"], p["lng"])

        implicit = np.tanh(implicit_map[pid])
        session = np.tanh(session_map[pid])

        rel_final = compute_relevance_final(explicit, implicit, session, alpha, beta)
        freshness = compute_freshness(post_age)
        B = compute_B(p["authority"])

        score_raw = compute_raw_rank_score(rel_final, freshness, B, post_age)
        score_bubble = apply_anti_bubble(score_raw, epsilon)

        results.append({
            "id": pid,
            "property_type": p["property_type"],
            "score_before_log": score_bubble,
            "breakdown": {
                "explicit": explicit,
                "implicit": implicit_map[pid],
                "session": session_map[pid],
                "freshness": freshness,
                "B": B
            }
        })

    results.sort(key=lambda x: x["score_before_log"], reverse=True)
    results = apply_diversity_penalty(results)
    results = percentile_normalize(results)

    return results

def export_sunfire_to_csv(results, filename="sunfire_score.csv"):
    if not results: return
    headers = ["id", "property_type", "final_score_log", "norm_score"] + list(results[0]["breakdown"].keys())
    with open(filename, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for item in results:
            row = {"id": item["id"], "property_type": item["property_type"], 
                   "final_score_log": round(item["final_score_log"], 6), 
                   "norm_score": round(item["norm_score"], 4)}
            row.update(item["breakdown"])
            writer.writerow(row)
    print(f"Exported to {filename}")

import csv
if __name__ == "__main__":
    res = run_sunfire_pipeline("./data/user_interaction_log.json", "./data/dummy_feed.json")
    export_sunfire_to_csv(res)
