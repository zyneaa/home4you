use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProcessingError {
    /// Corrupt or unsupported input — maps to moderation REJECT, not retry.
    #[error("corrupt or unsupported media: {0}")]
    Decode(String),

    /// Input exceeds declared resource limits (decompression-bomb guard).
    #[error("media exceeds resource limits: {0}")]
    TooLarge(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("video transcode failed: {0}")]
    Transcode(String),

    #[error("encode failed: {0}")]
    Encode(String),
}

/// True when the failure is about the *file itself* (bad bytes), not
/// transient infrastructure. The worker uses this to pick reject vs retry.
impl ProcessingError {
    pub fn is_file_defect(&self) -> bool {
        matches!(
            self,
            ProcessingError::Decode(_) | ProcessingError::TooLarge(_)
        )
    }
}
