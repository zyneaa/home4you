//! Thin Google Cloud Vision REST client (images:annotate, LABEL_DETECTION).
//! Credentials are server-side only: an API key from the environment, never
//! embedded in anything the client sees.

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::ClassificationError;

const ANNOTATE_URL: &str = "https://vision.googleapis.com/v1/images:annotate";
const MAX_LABELS: u32 = 20;

#[derive(Serialize)]
struct AnnotateRequest {
    requests: [ImageRequest; 1],
}

#[derive(Serialize)]
struct ImageRequest {
    image: ImageSource,
    features: [Feature; 1],
}

#[derive(Serialize)]
struct ImageSource {
    #[serde(rename = "content")]
    base64_content: String,
}

#[derive(Serialize)]
struct Feature {
    #[serde(rename = "type")]
    kind: &'static str,
    max_results: u32,
}

/// Raw provider response — public so callers (and tests) can inspect it.
#[derive(Debug, Deserialize)]
pub struct VisionResponse {
    pub responses: Vec<VisionResponseItem>,
}

#[derive(Debug, Deserialize)]
pub struct VisionResponseItem {
    #[serde(default)]
    pub label_annotations: Vec<LabelAnnotation>,
    pub error: Option<VisionError>,
}

#[derive(Debug, Deserialize)]
pub struct LabelAnnotation {
    pub description: String,
    pub score: f32,
}

#[derive(Debug, Deserialize)]
pub struct VisionError {
    pub code: i32,
    pub message: String,
    pub status: Option<String>,
}

pub struct VisionClient {
    http: reqwest::Client,
    api_key: String,
}

impl VisionClient {
    pub fn new(api_key: impl Into<String>) -> Result<Self, ClassificationError> {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| ClassificationError::Config(e.to_string()))?;
        Ok(Self {
            http,
            api_key: api_key.into(),
        })
    }

    /// Returns (provider_label, score) pairs.
    pub async fn detect_labels(
        &self,
        image_bytes: &[u8],
    ) -> Result<Vec<(String, f32)>, ClassificationError> {
        if self.api_key.is_empty() {
            return Err(ClassificationError::Config(
                "GOOGLE_VISION_API_KEY is not set".into(),
            ));
        }

        let body = AnnotateRequest {
            requests: [ImageRequest {
                image: ImageSource {
                    base64_content: base64::engine::general_purpose::STANDARD.encode(image_bytes),
                },
                features: [Feature {
                    kind: "LABEL_DETECTION",
                    max_results: MAX_LABELS,
                }],
            }],
        };

        let url = format!("{ANNOTATE_URL}?key={}", self.api_key);

        // Network-level failures are outage-class: retryable.
        let response = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| ClassificationError::Provider(e.to_string()))?;

        let status = response.status();
        if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(ClassificationError::Provider(format!(
                "vision api status {status}"
            )));
        }
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(ClassificationError::Config(format!(
                "vision api rejected request ({status}): {text}"
            )));
        }

        let parsed: VisionResponse = response
            .json()
            .await
            .map_err(|e| ClassificationError::Provider(format!("bad response body: {e}")))?;

        let item = parsed
            .responses
            .into_iter()
            .next()
            .ok_or_else(|| ClassificationError::Provider("empty responses".into()))?;

        if let Some(err) = item.error {
            // 5xx / RESOURCE_EXHAUSTED inside a 200 envelope are outages;
            // 4xx argument errors are config problems.
            if err.code >= 500 || err.code == 429 {
                return Err(ClassificationError::Provider(format!(
                    "vision error {}: {}",
                    err.code, err.message
                )));
            }
            return Err(ClassificationError::Config(format!(
                "vision error {}: {}",
                err.code, err.message
            )));
        }

        Ok(item
            .label_annotations
            .into_iter()
            .map(|a| (a.description, a.score))
            .collect())
    }
}
