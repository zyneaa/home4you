//! Home4You's application-owned label taxonomy and the normalization layer
//! that maps provider labels onto it. Provider labels are preserved for
//! auditing; unknown provider labels are dropped, not invented.

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct NormalizedLabel {
    pub name: String,
    pub score: f32,
    pub provider_label: String,
}

/// Provider label (lowercased) -> internal taxonomy label. Absent mappings
/// are ignored during normalization.
const PROVIDER_TO_INTERNAL: &[(&str, &str)] = &[
    ("room", "INTERIOR"),
    ("interior design", "INTERIOR"),
    ("indoor", "INTERIOR"),
    ("living room", "LIVING_ROOM"),
    ("bed", "BEDROOM"),
    ("bedroom", "BEDROOM"),
    ("kitchen", "KITCHEN"),
    ("bathroom", "BATHROOM"),
    ("furniture", "FURNITURE"),
    ("window", "INTERIOR"),
    ("house", "BUILDING"),
    ("home", "BUILDING"),
    ("building", "BUILDING"),
    ("apartment building", "BUILDING"),
    ("facade", "EXTERIOR"),
    ("architecture", "EXTERIOR"),
    ("garden", "GARDEN"),
    ("yard", "GARDEN"),
    ("landscaping", "GARDEN"),
    ("balcony", "EXTERIOR"),
    ("terrace", "EXTERIOR"),
    ("property", "PROPERTY"),
    ("real estate", "PROPERTY"),
    ("sky", "EXTERIOR"),
    ("tree", "GARDEN"),
    ("nature", "GARDEN"),
];

/// Provider labels that indicate content policy problems when the confidence
/// is clear. A *tree* label does not make a listing irrelevant; these do.
const BLOCKED_PROVIDER_LABELS: &[&str] = &[
    "nudity",
    "nsfw",
    "porn",
    "explicit content",
    "gore",
    "violence",
];

/// A label is "clear" when confidence leaves no reasonable doubt.
pub const CLEAR_CONFIDENCE: f32 = 0.80;
/// Below this, results are too weak to act on at all.
pub const AMBIGUOUS_CONFIDENCE: f32 = 0.50;

/// Normalize provider labels into the internal taxonomy. Deduplicates by
/// internal label keeping the highest score. Order: score descending.
pub fn normalize_labels(provider_labels: &[(String, f32)]) -> Vec<NormalizedLabel> {
    let mut best: std::collections::HashMap<&str, (&str, f32, String)> =
        std::collections::HashMap::new();

    for (provider_label, score) in provider_labels {
        let key = provider_label.trim().to_lowercase();
        let Some(internal) = PROVIDER_TO_INTERNAL
            .iter()
            .find(|(p, _)| *p == key)
            .map(|(_, internal)| *internal)
        else {
            continue;
        };

        let entry = best.entry(internal);
        match entry {
            std::collections::hash_map::Entry::Occupied(mut occ) => {
                if *score > occ.get().1 {
                    occ.insert((internal, *score, provider_label.clone()));
                }
            }
            std::collections::hash_map::Entry::Vacant(vac) => {
                vac.insert((internal, *score, provider_label.clone()));
            }
        }
    }

    let mut labels: Vec<NormalizedLabel> = best
        .into_values()
        .map(|(name, score, provider_label)| NormalizedLabel {
            name: name.to_string(),
            score,
            provider_label,
        })
        .collect();

    labels.sort_by(|a, b| b.score.total_cmp(&a.score));
    labels
}

/// True when a provider label is a policy problem with clear confidence.
pub fn is_blocked(provider_label: &str, score: f32) -> bool {
    let key = provider_label.trim().to_lowercase();
    score >= CLEAR_CONFIDENCE && BLOCKED_PROVIDER_LABELS.contains(&key.as_str())
}
