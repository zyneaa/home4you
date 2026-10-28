//! Safe image/video processing: decode with resource limits, orientation
//! handling, metadata stripping, and rendition generation.
//!
//! The raw original is never modified; optimized outputs are written to
//! separate S3 keys by the caller (media-worker app).

mod error;
mod image;
mod renditions;
mod video;

pub use error::ProcessingError;
pub use image::{decode_image, image_dimensions, DecodedImage};
pub use renditions::{encode_image_renditions, image_rendition_names, verify_roundtrip};
pub use video::{transcode_renditions, video_rendition_names};
