use std::fs::File;
use std::path::Path;

use rusqlite::{params, Connection};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::error::{AppError, AppResult};

/// Fully decoded PCM, interleaved f32 in [-1.0, 1.0].
#[derive(Debug, Clone)]
pub struct DecodedAudio {
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth_hint: Option<u32>,
    pub samples: Vec<f32>,
}

impl DecodedAudio {
    pub fn duration_ms(&self) -> f64 {
        if self.sample_rate == 0 || self.channels == 0 {
            return 0.0;
        }
        let frames = self.samples.len() as f64 / f64::from(self.channels);
        frames * 1000.0 / f64::from(self.sample_rate)
    }

    pub fn frame_count(&self) -> usize {
        if self.channels == 0 {
            0
        } else {
            self.samples.len() / usize::from(self.channels)
        }
    }
}

/// Decode an audio file to interleaved f32 PCM via Symphonia.
pub fn decode_file(path: &Path) -> AppResult<DecodedAudio> {
    let file = File::open(path).map_err(|e| {
        AppError::msg(format!("failed to open {}: {e}", path.display()))
    })?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            mss,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| AppError::msg(format!("probe failed for {}: {e}", path.display())))?;

    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| AppError::msg(format!("no audio track in {}", path.display())))?
        .clone();

    let audio_params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| AppError::msg(format!("missing audio codec params in {}", path.display())))?
        .clone();

    let sample_rate = audio_params
        .sample_rate
        .ok_or_else(|| AppError::msg("missing sample rate"))?;
    let channels = audio_params
        .channels
        .as_ref()
        .map(|c| c.count() as u16)
        .unwrap_or(1);
    let bit_depth_hint = audio_params.bits_per_sample;

    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&audio_params, &AudioDecoderOptions::default())
        .map_err(|e| AppError::msg(format!("decoder init failed: {e}")))?;

    let track_id = track.id;
    let mut samples: Vec<f32> = Vec::new();
    let mut packet_scratch: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(SymphoniaError::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::IoError(_)) => break,
            Err(e) => return Err(AppError::msg(format!("demux error: {e}"))),
        };

        if packet.track_id != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                packet_scratch.resize(audio_buf.samples_interleaved(), 0.0);
                audio_buf.copy_to_slice_interleaved(&mut packet_scratch);
                samples.extend_from_slice(&packet_scratch);
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(_)) => break,
            Err(e) => return Err(AppError::msg(format!("decode error: {e}"))),
        }
    }

    if samples.is_empty() {
        return Err(AppError::msg(format!(
            "no PCM decoded from {}",
            path.display()
        )));
    }

    Ok(DecodedAudio {
        sample_rate,
        channels,
        bit_depth_hint,
        samples,
    })
}

/// Probe a file, decode enough to know duration/rate/channels, write technical columns.
pub fn probe_and_update_sample(
    conn: &Connection,
    sample_id: i64,
    path: &Path,
) -> AppResult<DecodedAudio> {
    let decoded = decode_file(path)?;
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    let duration_ms = decoded.duration_ms();
    let bit_depth = decoded.bit_depth_hint.map(|b| b as i64);

    conn.execute(
        "UPDATE samples SET
            sample_rate = ?1,
            channels = ?2,
            duration_ms = ?3,
            format = COALESCE(?4, format),
            bit_depth = COALESCE(?5, bit_depth),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?6",
        params![
            decoded.sample_rate as i64,
            decoded.channels as i64,
            duration_ms,
            format,
            bit_depth,
            sample_id,
        ],
    )?;

    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn decode_example_wav() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../example_samples");
        let path = root.join("heatwave/Moods/mood-hopeful.wav");
        if !path.exists() {
            eprintln!("skip: missing {}", path.display());
            return;
        }
        let decoded = decode_file(&path).expect("decode");
        assert!(decoded.sample_rate > 0);
        assert!(decoded.channels >= 1);
        assert!(!decoded.samples.is_empty());
        assert!(decoded.duration_ms() > 0.0);
        let _ = decoded.bit_depth_hint;
    }
}
