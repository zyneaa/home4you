use std::io::Cursor;

use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat};

use crate::error::ProcessingError;

/// Rendition names and their max long-edge in pixels. Keep in sync with the
/// key layout: `media/u/{userId}/p/{postId}/{mediaId}/optimized/{name}`.
pub const IMAGE_RENDITIONS: &[(&str, u32)] = &[("webp-1200", 1200), ("webp-400", 400)];

pub fn image_rendition_names() -> Vec<&'static str> {
    IMAGE_RENDITIONS.iter().map(|(n, _)| *n).collect()
}

/// Resize (never upscale) and lossy-encode WebP renditions.
///
/// Re-encoding from the decoded source strips EXIF/metadata by construction:
/// the output contains only pixels.
pub fn encode_image_renditions(
    source: &DynamicImage,
) -> Result<Vec<(&'static str, Vec<u8>)>, ProcessingError> {
    IMAGE_RENDITIONS
        .iter()
        .map(|(name, max_edge)| {
            let resized = resize_to_max_edge(source, *max_edge);
            let bytes = encode_webp(&resized)?;
            Ok((*name, bytes))
        })
        .collect()
}

fn resize_to_max_edge(source: &DynamicImage, max_edge: u32) -> DynamicImage {
    let longest = source.width().max(source.height());
    if longest <= max_edge {
        return source.clone();
    }
    let scale = f64::from(max_edge) / f64::from(longest);
    let width = ((f64::from(source.width()) * scale).round() as u32).max(1);
    let height = ((f64::from(source.height()) * scale).round() as u32).max(1);
    source.resize_exact(width, height, FilterType::Lanczos3)
}

fn encode_webp(img: &DynamicImage) -> Result<Vec<u8>, ProcessingError> {
    let mut out = Cursor::new(Vec::new());
    // NOTE: the pure-Rust `image` webp encoder is lossless-only. Files stay
    // correct WebP (and metadata-free); swap in libwebp (lossy, smaller
    // files) as a follow-up tuning step if size matters more than purity.
    let encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut out);
    img.write_with_encoder(encoder)
        .map_err(|e| ProcessingError::Encode(e.to_string()))?;
    Ok(out.into_inner())
}

/// Sanity check that an encoded rendition is decodable before we claim it
/// is DONE (cheap idempotency guard against writing truncated output).
pub fn verify_roundtrip(bytes: &[u8]) -> Result<(), ProcessingError> {
    image::load_from_memory_with_format(bytes, ImageFormat::WebP)
        .map_err(|e| ProcessingError::Encode(format!("rendition roundtrip failed: {e}")))?;
    Ok(())
}
