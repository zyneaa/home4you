use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClassificationError {
    /// Provider unreachable / 5xx / throttling: retryable — do NOT reject
    /// the image because of an API outage.
    #[error("provider outage: {0}")]
    Provider(String),

    /// Missing/invalid credentials or malformed request: retrying will not
    /// help; surface as a configuration failure.
    #[error("classification misconfigured: {0}")]
    Config(String),
}

impl ClassificationError {
    pub fn is_retryable(&self) -> bool {
        matches!(self, ClassificationError::Provider(_))
    }
}
