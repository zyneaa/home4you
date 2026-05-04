"""
Sunfire Engine – Parameter Configuration

This file defines all tunable parameters used in the ranking pipeline,
directly mapping to the mathematical models in sunfire.md.
"""

# =========================================================
# 1. RELEVANCE (Personalization & Session Intent)
# =========================================================

# β_max (Implicit Bias Max): The hard limit preventing behavior from 
# completely overriding explicit filters.
# Effect: If set to 1.0, a user who clicks on 10 cats will only see cats, 
# ignoring their "I want dogs" filter. 
# Example: 0.8 ensures 20% of the score always comes from explicit intent.
BETA_MAX = 0.8

# K (Interaction Threshold): Number of interactions needed to reach BETA_MAX.
# Effect: Controls the learning curve. Small K = fast adaptation; Large K = stable feed.
# Example: K = 50 means the system "trusts" your behavior fully after 50 actions.
K_THRESHOLD = 50

# r (Comfort Zone Radius): Gaussian radius in km for geographic matching.
# Effect: Controls the "softness" of location filters. 
# Example: r = 5.0 means properties 5km away keep ~60% of their distance score.
R_COMFORT_ZONE = 5.0

# λ_time (Historical Decay): Decay constant for historical interactions.
# Effect: How fast the system "forgets" your past behavior.
# Example: 0.005 is slow; a click from a month ago still has some weight.
LAMBDA_HISTORICAL = 0.005

# λ_session (Session Decay): Aggressive decay for in-session actions.
# Effect: High values make the "Right Now" behavior very reactive.
# Example: 0.1 means an item clicked 10 minutes ago is much more relevant than one from 2 hours ago.
LAMBDA_SESSION = 0.1

# γ (Session Weight): Integration factor between history and current session.
# Effect: Controls how much the current session "hijacks" the feed.
# Example: 0.5 means a 50/50 blend of "who you are" vs "what you are doing now".
GAMMA_SESSION_WEIGHT = 0.5


# =========================================================
# 2. FRESHNESS (Temporal Dynamics)
# =========================================================

# λ_base (Global Decay): Standard exponential decay rate for content age.
# Effect: Higher values rotate the feed faster.
# Example: 0.05 means a post loses ~50% of its freshness score in ~14 hours.
LAMBDA_BASE = 0.05

# λ_user (Decay Resistance): Bonus earned by highly active/trusted users.
# Effect: Allows "Power User" content to stay fresh longer than average posts.
# Example: 0.002 makes a post from a top creator decay slightly slower.
LAMBDA_USER_RESISTANCE = 0.002

# θ (Freshness Floor): Minimum decay to ensure content eventually rotates out.
# Effect: Prevents very old content from getting stuck at the top.
# Example: 0.001 ensures even a 1-year-old post has a non-zero (but tiny) freshness.
FRESHNESS_FLOOR = 0.001


# =========================================================
# 3. TRUST & ACTIVITY (Ecosystem Health - B Score)
# =========================================================

# φ (Reach Ceiling): Maximum possible activity boost for a contributor.
# Effect: Limits how much "grinding" (posting a lot) can boost a user's visibility.
# Example: 0.5 ensures that even the most active user can't double their score on activity alone.
PHI_REACH_CEILING = 0.5

# σ (Grind Factor): The slope of the activity reward curve.
# Effect: Controls how rewarding each additional post is.
# Example: 0.1 creates a logarithmic curve that rewards the first 10 posts more than the next 100.
SIGMA_GRIND_FACTOR = 0.1

# Minimum compliance floor (C). Values < 0.4 usually trigger filtering.
COMPLIANCE_FLOOR = 0.4


# =========================================================
# 4. EXPLORATION (Anti-Bubble)
# =========================================================

# ε_new (Exploration Rate - New User): Randomness for users with little data.
# Effect: Helps the system discover what a new user likes quickly.
# Example: 0.2 means 20% of the feed is randomized to test preferences.
EPSILON_NEW_USER = 0.2

# ε_old (Exploration Rate - Veteran User): Randomness for established users.
# Effect: Keeps the feed stable while allowing for occasional discovery.
# Example: 0.01 provides just enough "surprise" to break the filter bubble.
EPSILON_OLD_USER = 0.01


# =========================================================
# 5. DIVERSITY & PIPELINE
# =========================================================

# γ^n (Diversity Penalty Base): The decay factor for repeated categories.
# Effect: Drastically reduces the score of the Nth item from the same category.
# Example: 0.5 means the 2nd Condo gets half score, the 3rd gets 25%, etc.
GAMMA_DIVERSITY_FACTOR = 0.5

# T_new (Cold Start Window): Duration in hours for the "New Post" bonus.
# Effect: Gives every new post a guaranteed window of high visibility.
# Example: 48.0 ensures all posts are treated as "New" for the first two days.
T_NEW_WINDOW = 48.0

# Bonus (Cold Start Bonus): Flat additive boost for new content.
# Effect: Forces new content to the top regardless of relevance.
COLD_START_BONUS = 2.0


# =========================================================
# 6. SIMULATION SETTINGS (Generator Weights)
# =========================================================

# Weights and dwell time ranges for synthetic interaction generation.
INTERACTIONS = {
    "view":    {"weight": 0.1, "chance": 0.6, "dwell_range": (5, 30)},
    "click":   {"weight": 0.5, "chance": 0.3, "dwell_range": (30, 120)},
    "like":    {"weight": 1.5, "chance": 0.08, "dwell_range": (60, 300)},
    "share":   {"weight": 3.0, "chance": 0.02, "dwell_range": (120, 600)},
    "contact": {"weight": 5.0, "chance": 0.005, "dwell_range": (200, 600)}
}

# Average time spent per session in the simulation.
USER_TIME_SPENT = 720
