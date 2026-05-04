import json
import random
import os
from datetime import datetime, timedelta
from parameters import INTERACTIONS, USER_TIME_SPENT


def generate_user_interactions(feed_file, duration_hours=720):
    with open(feed_file, 'r') as f:
        properties = json.load(f)

    interactions = []
    current_time = datetime.now() - timedelta(hours=duration_hours)
    end_time = datetime.now()

    # USER PERSONA
    preferred_type = random.choice(["condo", "house", "apartment", "land", "material", "construction"])
    preferred_trans = random.choice(["rent", "buy", "none"])

    session_number = 0

    # CENTROID
    sum_weighted_lat = 0.0
    sum_weighted_lng = 0.0
    total_interaction_weight = 0.0

    while current_time < end_time:
        hour = current_time.hour
        session_chance = 0.05 if (2 <= hour <= 6) else 0.2

        if random.random() < session_chance:
            session_length = random.randint(5, 25)
            activity_factor = 0.0
            seen_this_session = set()

            for _ in range(session_length):

                # DISTRACTION
                if random.random() < 0.10:
                    activity_factor = max(0.0, activity_factor - 0.2)
                    current_time += timedelta(minutes=random.randint(1, 3))
                    continue

                # UNIQUE SELECTION
                candidates = [p for p in properties if p['id'] not in seen_this_session]
                if not candidates:
                    break

                biased = [
                    p for p in candidates
                    if p['property_type'] == preferred_type and
                       p['transaction_type'] == preferred_trans
                ]

                pool = biased if (biased and random.random() < 0.7) else candidates
                prop = random.choice(pool)
                seen_this_session.add(prop['id'])

                # INTERACTION
                roll = random.random()
                chosen_actions = ["view"]

                if roll < 0.45:
                    chosen_actions.append("click")
                if roll < 0.18:
                    chosen_actions.append("like")
                if roll < 0.05:
                    chosen_actions.append("share")
                    if "like" not in chosen_actions:
                        chosen_actions.append("like")

                unique_actions = list(set(chosen_actions))
                total_weight = sum(INTERACTIONS[a]["weight"] for a in unique_actions)

                # CENTROID UPDATE
                sum_weighted_lat += prop["lat"] * total_weight
                sum_weighted_lng += prop["lng"] * total_weight
                total_interaction_weight += total_weight

                # ACTIVITY FACTOR
                activity_boost = total_weight / 50.0
                activity_factor += (0.1 + activity_boost)

                # DWELL
                max_action = max(unique_actions, key=lambda a: INTERACTIONS[a]["weight"])
                actual_dwell = random.randint(*INTERACTIONS[max_action]['dwell_range'])

                # LOG
                interaction = {
                    "session_number": session_number,
                    "timestamp": current_time.isoformat(),
                    "listing_id": prop['id'],

                    # raw behavior
                    "action": unique_actions,
                    "weight": total_weight,
                    "dwell_time_sec": actual_dwell,
                    "activity_factor": round(activity_factor, 2),
                    "is_distracted": False,

                    # minimal context (NO feature engineering)
                    "prop_lat": prop['lat'],
                    "prop_lng": prop['lng'],
                    "property_type": prop['property_type'],
                    "transaction_type": prop['transaction_type'],
                    "category": prop.get("category", "unknown")
                }

                interactions.append(interaction)

                current_time += timedelta(seconds=actual_dwell + random.randint(5, 15))

            session_number += 1

        current_time += timedelta(minutes=15)

    # FINAL CENTROID
    if total_interaction_weight > 0:
        final_target_lat = sum_weighted_lat / total_interaction_weight
        final_target_lng = sum_weighted_lng / total_interaction_weight
    else:
        # Default fallback
        final_target_lat = 21.95
        final_target_lng = 96.05

    final_output = {
        "user_profile": {
            "preferred_type": preferred_type,
            "preferred_trans": preferred_trans,
            "target_lat": round(final_target_lat, 6),
            "target_lng": round(final_target_lng, 6),
            "total_sessions": session_number,
            "generated_at": datetime.now().isoformat()
        },
        "interactions": interactions
    }

    os.makedirs('./data', exist_ok=True)

    with open('./data/user_interaction_log.json', 'w') as f:
        json.dump(final_output, f, indent=2)

    print(f"Generated {len(interactions)} interactions across {session_number} sessions.")


if __name__ == "__main__":
    generate_user_interactions('./data/dummy_feed.json', duration_hours=USER_TIME_SPENT)
