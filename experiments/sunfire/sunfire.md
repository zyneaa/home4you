# Sunfire Engine: The Global Ranking & Feed Architecture

The Sunfire Engine is a high-performance ranking pipeline designed to balance user intent, temporal relevance, and ecosystem health. It transforms raw property data into a personalized, diverse, and normalized feed.

---

## 1. Relevance Score ($Relevance_{final}$)
The core of personalization, blending long-term preferences with immediate session behavior.

### 1.1 Base Relevance ($Relevance$)
$$Relevance = (1 - \beta) \times Explicit + \beta \times Implicit$$
* **$\beta$ (Implicit Bias):** $\min(\beta_{max}, \frac{Interaction\ Count}{K})$. Shifts from explicit intent to observed behavior as data grows.
* **$\beta_{max}$:** Hard limit to prevent implicit data from completely overriding explicit filters.
* **$K$:** The interaction threshold required to reach maximum implicit weighting.

#### 1.1.1 Explicit Intent ($Explicit$)
Determined by the **Centroid of Intent** ($Target_{lat, lng}$) and cosine similarity.
* **$Target_{lat, lng}$:** The weighted center of where a user actively clicks/searches.
* **$d$:** Haversine distance between $Target$ and actual $Property_{lat, lng}$.
* **$d$ :**  $haversine( (Target_{lat},\ Target_{lng}) ,\ (Property_{lat},\ Property_{lng}))$
* **$Distance\ Score$:** $e^{\frac{-d^2}{2r^2}}$ (Gaussian decay).
* **$r$:** The radius of the user's geographic consideration "comfort zone."
* **$Cosine\ Similarity$:** Vector match between User ($A$) and Property ($B$).
$$Cosine\ Similarity = \frac{\sum A_i B_i}{\sqrt{\sum A_i^2} \sqrt{\sum B_i^2}}$$
* **$Explicit = Preference\ Score(Cosine\ Similarity) \times Distance\ Score$**.

#### 1.1.2 Implicit Intent ($Implicit$)
Calculated from historical interactions and dwell time.
* **$Implicit = log(1 + Implicit_{raw})$**
* **$Implicit_{raw} = \sum (Value_i \times D_i \times e^{-\lambda_{time} \Delta t_i})$**
* **$Value_i$:** Numeric weight assigned to an event (e.g., Like=2, Message=5).
* **$D_i$ (Dwell Factor):** $\ln(e + dwell\ time_{sec} \times activity\ factor)$.
* **$\lambda_{time}$:** Decay constant for historical interactions.
* **$\Delta t_i$:** Time elapsed since the interaction occurred.

### 1.2 Session Intent ($Session\ Intent$)
Captures "in-the-moment" interest within the current app session.
$$Session\ Intent = \sum (Weight_j \times Match_j \times D_j \times e^{-\lambda_{session} \Delta t_j})$$
* **$Weight_j$:** The importance of the specific session event.
* **$Match_j$:** How well the current post matches the session event's metadata.
* **$\lambda_{session}$:** Aggressive decay constant (session interests change fast).

### 1.3 Final Relevance Integration
$$Relevance_{final} = Relevance \times (1 - \gamma) + Session\ Intent \times \gamma$$
* **$\gamma$:** The "Session Weight" (how much current behavior overrides history).

---

## 2. Freshness ($Freshness$)
Ensures the feed remains dynamic and new content surfaces.
$$Freshness = e^{-\lambda_{effective} \times t}$$
* **$\lambda_{effective}$:** $\max(\lambda_{base} - \lambda_{user}, \theta)$.
* **$\lambda_{base}$:** Standard global decay rate.
* **$\lambda_{user}$:** Bonus decay-resistance earned through high user engagement.
* **$\theta$:** The "Freshness Floor" (minimum decay to ensure eventual rotation).
* **$t$:** Age of the post in hours.

---

## 3. Trust & Activity ($B$)
The "Ecosystem" score that rewards high-quality contributors.
$$B = Compliance\ Score + Activity\ Modifier + Boost_{Logic}$$
* **$Compliance\ Score$:** Safety/Verification floor ($0.4 < C < 1.0$).
* **$Activity\ Modifier$:** $\phi \times \ln(1 + P_{recent} \times \sigma)$.
* **$\phi$ (Phi):** The "Reach Ceiling" (max possible activity boost).
* **$P_{recent}$:** Count of quality posts in a sliding window (e.g., 7 days).
* **$\sigma$ (Sigma):** The "Grind Factor" (slope of the reward curve).
* **$Boost_{Logic}$:** Time-decayed artificial boost for promoted content.

---

## 4. Exploration & Diversity
* **$\epsilon$ (Exploration Rate):** Controls randomness ($\epsilon_{new} \approx 0.5$, $\epsilon_{old} \approx 0.02$).
* **$\gamma^n$ (Diversity Penalty):** Decay factor (0.7–0.9) raised to the power of $n$ (count of same-category items already shown).

---

## 5. Combining All Together
$$score_{norm} = percentile(score)$$
* **$score$:** $log(1 + score_{raw})$
* **$score_{raw}$:** = $(R_{final} \times F) \times (1 + B) + \mathbb{1}_{t < T_{new}} \, \text{Bonus}$

---
## 6. The Unified Pipeline (Final Equation)
The complete mathematical flow from raw data to a normalized $0.0 - 1.0$ score.


$$
\text{Final Score} = \operatorname{percentile}\left(
\left(
\left(
\left( R_{\text{final}} \cdot F \right) \cdot (1 + B) + \mathbb{1}_{t < T_{\text{new}}}\,\text{Bonus}
\right)
(1 - \epsilon)
+ \text{Rand} \cdot \epsilon
\right)
\cdot \gamma^n
\right)
$$


### Final Variable Summary
| Variable | Context | Definition |
| :--- | :--- | :--- |
| $R_{final}$ | Relevance | Blended Explicit, Implicit, and Session scores. |
| $F$ | Freshness | Temporal decay based on age ($t$) and user activity. |
| $B$ | Authority | Combined Trust, Activity Modifier, and Boosts. |
| $\mathbb{1}_{t < T_{new}}$ | Cold Start | Boolean (1 if post is within $T_{new}$ window, else 0). |
| $\epsilon$ | Explore | Randomness factor to break filter bubbles. |
| $\gamma^n$ | Diversity | Category-based penalty to ensure feed variety. |
| Percentile | Normalization | Rank-based normalization within candidate set (0–1). |