//! Moderation policy: what classification results MEAN for the product.
//!
//! Rules are explicit; a generic Vision label is never treated as a
//! definitive verdict about the listing itself:
//!
//! | Result                                            | Action                        |
//! |---------------------------------------------------|-------------------------------|
//! | File is corrupt or unsupported                    | Reject the file               |
//! | Required safety check clearly fails policy        | Reject                        |
//! | Result is ambiguous                               | Send for review               |
//! | Image valid but classification failed (API outage)| Retry, never auto-reject      |
//! | Image valid and required checks pass              | Allow publication to proceed  |
//!
//! Note: a "tree" label does not make an image irrelevant to a listing, and
//! a "house" label does not prove the listing is a house. Labels never
//! override user-entered listing fields.

use crate::labels::{is_blocked, NormalizedLabel, AMBIGUOUS_CONFIDENCE, CLEAR_CONFIDENCE};

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "decision", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModerationDecision {
    /// Strong, safe signal — publish without review.
    Approve { top_labels: Vec<NormalizedLabel> },
    /// Weak/ambiguous signal or genuinely uncertain content — queue for
    /// human review (conservative policy).
    Review {
        reason: String,
        top_labels: Vec<NormalizedLabel>,
    },
    /// Clear policy violation.
    Reject { reason: String },
}

/// Decide `Media.moderationStatus` from normalized labels.
pub fn decide_moderation(
    provider_labels: &[(String, f32)],
    normalized: &[NormalizedLabel],
) -> ModerationDecision {
    // 1. Blocked content with clear confidence — reject outright.
    if let Some((label, score)) = provider_labels
        .iter()
        .find(|(label, score)| is_blocked(label, *score))
    {
        return ModerationDecision::Reject {
            reason: format!("blocked content label '{label}' at confidence {score:.2}"),
        };
    }

    // 2. No usable signal at all — conservative: human review.
    if normalized.is_empty() {
        return ModerationDecision::Review {
            reason: "no labels mapped to taxonomy".into(),
            top_labels: vec![],
        };
    }

    // 3. Best signal too weak to trust — review.
    if normalized[0].score < AMBIGUOUS_CONFIDENCE {
        return ModerationDecision::Review {
            reason: format!(
                "top label '{}' below ambiguity threshold {AMBIGUOUS_CONFIDENCE}",
                normalized[0].name
            ),
            top_labels: normalized.to_vec(),
        };
    }

    // 4. If nothing reaches CLEAR confidence, the reviewer should look.
    if normalized[0].score < CLEAR_CONFIDENCE {
        return ModerationDecision::Review {
            reason: format!(
                "top label '{}' below clear threshold {CLEAR_CONFIDENCE}",
                normalized[0].name
            ),
            top_labels: normalized.to_vec(),
        };
    }

    // 5. Clear, safe signal — proceed.
    ModerationDecision::Approve {
        top_labels: normalized.iter().take(5).cloned().collect(),
    }
}
