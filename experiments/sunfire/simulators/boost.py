import sys
import os

import numpy as np
from datetime import datetime

parent_dir = os.path.abspath(os.path.join(os.getcwd(), ".."))

if parent_dir not in sys.path:
    sys.path.append(parent_dir)

from parameters import *
from data import *

def calculate_boost(t_boost, tokens_spent):
    raw = 1 + np.log10(1 + tokens_spent)
    boost_capped = min(raw, BOOST_CAP)

    # 2. Apply Piecewise Decay Logic
    if t_boost <= BOOST_HOLD_HOURS:
        return boost_capped
    else:
        # Exponential decay: falls back toward 1.0 (neutral)
        decay = np.exp(-LAMBDA_BOOST * (t_boost - BOOST_HOLD_HOURS))
        return 1.0 + (boost_capped - 1.0) * decay

def compute_trust_score(rating, verified):
    score = TRUST_SIGMA + (rating * RATING_MULTIPLIER)
    if verified:
        score += VERIFIED_BONUS
    return score

def compute_freshness(post_age_hours):
    lam_eff = max(LAMBDA_BASE - LAMBDA_USER_OFFSET, FRESHNESS_FLOOR)
    return np.exp(-lam_eff * post_age_hours)
