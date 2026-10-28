//! High-level classification service: provider call + normalization +
//! policy, independent from image optimization. A Vision outage here must
//! never prevent optimization from succeeding.

use serde::Serialize;

use crate::error::ClassificationError;
use crate::labels::{normalize_labels, NormalizedLabel};
use crate::policy::{decide_moderation, ModerationDecision};
use crate::provider::VisionClient;
pub use crate::provider::VisionResponse;

/// Bump when normalization taxonomy or thresholds change; results are keyed
/// by this so a new pipeline re-classifies rather than reusing stale labels.
pub const CLASSIFICATION_PIPELINE_VERSION: &str = "1";

#[derive(Debug, Serialize, Clone)]
pub struct ClassificationOutcome {
    pub provider: &'static str,
    pub pipeline_version: String,
    pub model_version: Option<String>,
    pub labels: Vec<NormalizedLabel>,
    pub moderation: ModerationDecision,
}

pub struct ClassificationService {
    vision: VisionClient,
}

impl ClassificationService {
    pub fn new(api_key: impl Into<String>) -> Result<Self, ClassificationError> {
        Ok(Self {
            vision: VisionClient::new(api_key)?,
        })
    }

    /// Classify raw image bytes. Returns the normalized outcome; only
    /// provider/config failures produce `Err`.
    pub async fn classify(
        &self,
        image_bytes: &[u8],
    ) -> Result<ClassificationOutcome, ClassificationError> {
        let provider_labels = self.vision.detect_labels(image_bytes).await?;
        let normalized = normalize_labels(&provider_labels);
        let moderation = decide_moderation(&provider_labels, &normalized);

        Ok(ClassificationOutcome {
            provider: "google-cloud-vision",
            pipeline_version: CLASSIFICATION_PIPELINE_VERSION.to_string(),
            model_version: None,
            labels: normalized,
            moderation,
        })
    }
}

impl From<VisionResponse> for Vec<(String, f32)> {
    fn from(value: VisionResponse) -> Self {
        value
            .responses
            .into_iter()
            .next()
            .map(|item| {
                item.label_annotations
                    .into_iter()
                    .map(|a| (a.description, a.score))
                    .collect()
            })
            .unwrap_or_default()
    }
}
