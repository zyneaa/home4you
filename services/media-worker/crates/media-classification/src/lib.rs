//! Google Cloud Vision integration, response normalization into Home4You's
//! own label taxonomy, and the moderation policy that maps classification
//! results to `Media.moderationStatus`.

mod error;
mod labels;
mod policy;
mod provider;
mod service;

pub use error::ClassificationError;
pub use labels::{normalize_labels, NormalizedLabel};
pub use policy::{decide_moderation, ModerationDecision};
pub use service::{
    ClassificationOutcome, ClassificationService, VisionResponse, CLASSIFICATION_PIPELINE_VERSION,
};
