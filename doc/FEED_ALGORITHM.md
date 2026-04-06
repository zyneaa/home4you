# Feed Algorithm: The Home4You Discovery Engine (v2.0)

This document defines the mathematical model and execution flow for the Home4You algorithmic feed, emphasizing the balance between explicit user preferences and implicit behavioral data.

## 1. The Ranking Formula

The final rank of a post for a specific user is determined by:

$$Rank Score = (Relevance \times Freshness) + (Trust Score + Boost Modifier)$$

### A. Boost Modifier (Commercial)
$$Boost Modifier = 1 + \log_{10}(1 + Tokens Spent)$$

### B. Freshness (Temporal Decay)
$$Freshness = e^{-(\lambda_{base} - \lambda_{user}) \times t}$$
- $t$: Age of post in hours.
- $\lambda_{base}$: Standard platform decay rate.
- $\lambda_{user}$: Counter-decay value based on user's lifetime spend/tier.

### C. Relevance (The $\alpha/\beta$ Balance)
Relevance transitions from explicit preferences to implicit behavior as the user interacts with the app.

$$Relevance = \alpha \times Explicit + \beta \times Implicit$$

- $\beta = \min(0.7, \frac{interaction\_count}{100})$: As interactions increase, behavioral data takes more weight (up to 70%).
- $\alpha = 1 - \beta$: Explicit preferences/GPS dominate for new users.

#### Explicit Data Component
1. **Preference Value:** 1.0 if location/type matches perfectly, scales down based on distance.
2. **GPS Fallback:** If no preferences are set, uses current GPS ping (1.0 for proximity, 0.3 for distance).
3. **Gaussian Distance Decay:** $Distance Value = e^{-\frac{d^2}{2r^2}}$ ($d$=distance, $r$=radius).
4. **Target Location Cache:** A behavioral "Target Location" that updates silently if a user in Point A keeps looking at Point B.

#### Implicit Data Component
Uses an event stream (likes, saves, dwell time) to calculate affinity.
$$Implicit Weight = \sum(Interaction Value \times Time Decay)$$
- This counters sudden interest shifts and prioritizes long-term behavioral trends (e.g., favoring "Agent" listings over "P2P").

### D. Trust Score (Safety)
$$Trust Multiplier = 0.7 + (Rating \times 0.1) + Verification Bonus$$
- **Linear Shift (0.7):** Ensures visibility even for lower-rated users, preventing "unrecoverable" scores.
- **Verification Bonus:** A flat multiplier for verified badge holders.

---

## 2. Execution Flow

### Phase 1: Filter (Hard Constraints)
- **Scope:** Filter by `Country` and `Status`.
- **Status:** Database Level (Indexed).

### Phase 2: Scoring (Background/Static)
- **Trigger:** On Post Creation, Update, or Token Boost.
- **Components:** Calculate `Trust Score` + `Boost Modifier`.
- **Storage:** Persisted as `static_power` in the `Post` model.

### Phase 3: Dynamic (Real-time/On-Refresh)
- **Trigger:** `GET /feed`.
- **Calculations:**
    1. **Personalization Balance:** Calculate $\alpha$ and $\beta$ based on `interaction_count`.
    2. **Distance Decay:** Based on `Target Location` (GPS or Behavioral Cache).
    3. **Freshness:** Based on `last_boost_at`.
    4. **Implicit Weights:** Pull from the Interaction Event Stream.

---

## 3. Data Requirements

| Entity | Field | Purpose |
| :--- | :--- | :--- |
| **User** | `tokens` | Currency balance for boosting |
| **User** | `rating` | 1-5 trust score |
| **User** | `isVerified` | Boolean status |
| **User** | `targetLocation` | Behavioral GPS center |
| **User** | `interactionCount` | To calculate $\alpha / \beta$ weights |
| **Post** | `tokensSpent` | Total tokens allocated |
| **Post** | `lastBoostAt` | Reference for Freshness |
| **Post** | `staticPower` | Pre-calculated Trust + Boost |
| **Interaction** | `type/value` | Event stream for Implicit Data |
