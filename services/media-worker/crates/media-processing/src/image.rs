use std::io::Cursor;

use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};

use crate::error::ProcessingError;

/// Hard pixel-count ceiling. A 50 KB compressed upload can decompress to
/// gigabytes; never trust the compressed size.
pub const MAX_PIXELS: u64 = 60_000_000;

pub struct DecodedImage {
    /// Orientation applied; EXIF metadata intentionally NOT carried forward —
    /// re-encoding to WebP strips metadata (GPS, camera info, comments).
    pub image: DynamicImage,
    pub width: u32,
    pub height: u32,
    pub format: ImageFormat,
}

/// Validate + decode an image with bounded resource usage.
pub fn decode_image(bytes: &[u8]) -> Result<DecodedImage, ProcessingError> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| ProcessingError::Decode(e.to_string()))?;

    let format = reader
        .format()
        .ok_or_else(|| ProcessingError::Decode("unknown image format".into()))?;

    // Check declared dimensions BEFORE decoding into memory.
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| ProcessingError::Decode(e.to_string()))?;

    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_PIXELS {
        return Err(ProcessingError::TooLarge(format!(
            "{width}x{height} = {pixels} px exceeds limit {MAX_PIXELS} px"
        )));
    }

    // Full decode with orientation: header ok but body corrupt is still a
    // file defect.
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()?
        .into_decoder()
        .map_err(|e| ProcessingError::Decode(e.to_string()))?;

    // Apply EXIF orientation so renditions are not rotated sideways, and the
    // re-encode drops the tag (metadata stripped by design).
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|e| ProcessingError::Decode(e.to_string()))?;
    image.apply_orientation(orientation);

    Ok(DecodedImage {
        width: image.width(),
        height: image.height(),
        image,
        format,
    })
}

/// Cheap header-only dimension probe (no full decode).
pub fn image_dimensions(bytes: &[u8]) -> Result<(u32, u32), ProcessingError> {
    ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| ProcessingError::Decode(e.to_string()))?
        .into_dimensions()
        .map_err(|e| ProcessingError::Decode(e.to_string()))
}
