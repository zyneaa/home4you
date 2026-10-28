use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::error::ProcessingError;

/// Video rendition names and target heights. Produced via the FFmpeg CLI so
/// we do not link a heavy ffmpeg binding; ffmpeg must be on PATH.
pub const VIDEO_RENDITIONS: &[(&str, u32)] = &[("mp4-720", 720), ("mp4-360", 360)];

pub fn video_rendition_names() -> Vec<&'static str> {
    VIDEO_RENDITIONS.iter().map(|(n, _)| *n).collect()
}

const TRANSCODE_TIMEOUT_SECS: u64 = 15 * 60;

/// Transcode `input` into MP4 renditions with capped heights (never upscale).
/// Returns (rendition_name, output_path) pairs; outputs land in `out_dir`.
pub async fn transcode_renditions(
    input: &Path,
    out_dir: &Path,
) -> Result<Vec<(&'static str, PathBuf)>, ProcessingError> {
    tokio::fs::create_dir_all(out_dir).await?;

    let mut outputs = Vec::new();
    for (name, height) in VIDEO_RENDITIONS {
        let out_path = out_dir.join(format!("{name}.mp4"));
        let input_arg = input.to_string_lossy().into_owned();
        let scale_arg = format!("scale=-2:{height}");
        let out_arg = out_path.to_string_lossy().into_owned();
        let args = [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            input_arg.as_str(),
            "-vf",
            scale_arg.as_str(),
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            out_arg.as_str(),
        ];
        let mut command = Command::new("ffmpeg");
        command.args(args);

        let status = tokio::time::timeout(
            std::time::Duration::from_secs(TRANSCODE_TIMEOUT_SECS),
            command.status(),
        )
        .await
        .map_err(|_| {
            ProcessingError::Transcode(format!(
                "ffmpeg timed out after {TRANSCODE_TIMEOUT_SECS}s for rendition {name}"
            ))
        })?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ProcessingError::Transcode("ffmpeg binary not found on PATH".into())
            } else {
                ProcessingError::Transcode(e.to_string())
            }
        })?;

        if !status.success() {
            return Err(ProcessingError::Transcode(format!(
                "ffmpeg exited with {status} for rendition {name}"
            )));
        }

        outputs.push((*name, out_path));
    }

    Ok(outputs)
}
