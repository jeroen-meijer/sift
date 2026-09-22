use std::fs::File;
use std::path::Path;

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use crate::db::schema::samples::dsl as samples_dsl;
use crate::db::utc_now;
use crate::error::{AppError, AppResult};
use crate::ids::id_from_i64;

/// Fully decoded PCM, interleaved f32 in [-1.0, 1.0].
#[derive(Debug, Clone)]
pub struct DecodedAudio {
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth_hint: Option<u32>,
    pub samples: Vec<f32>,
}

impl DecodedAudio {
    #[allow(
        clippy::as_conversions,
        clippy::cast_precision_loss,
        reason = "sample counts stay far below f64 mantissa range"
    )]
    pub fn duration_ms(&self) -> f64 {
        if self.sample_rate == 0 || self.channels == 0 {
            return 0.0;
        }
        let frames = self.samples.len() as f64 / f64::from(self.channels);
        frames * 1000.0 / f64::from(self.sample_rate)
    }

    pub fn frame_count(&self) -> usize {
        self.samples
            .len()
            .checked_div(usize::from(self.channels))
            .unwrap_or(0)
    }
}

/// Decode an audio file to interleaved f32 PCM via Symphonia.
pub fn decode_file(path: &Path) -> AppResult<DecodedAudio> {
    let file = File::open(path)
        .map_err(|e| AppError::msg(format!("failed to open {}: {e}", path.display())))?;
    let mss = MediaSourceStream::new(
        Box::new(file),
        symphonia::core::io::MediaSourceStreamOptions::default(),
    );

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
        .map_or(1, |c| u16::try_from(c.count()).unwrap_or(1));
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

            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Ok(None) | Err(SymphoniaError::IoError(_)) => break,
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
            Err(SymphoniaError::DecodeError(_)) => {}
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
    conn: &mut SqliteConnection,
    sample_id: i64,
    path: &Path,
) -> AppResult<DecodedAudio> {
    let decoded = decode_file(path)?;
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let duration_ms = decoded.duration_ms();
    let bit_depth = decoded.bit_depth_hint.and_then(|b| i32::try_from(b).ok());
    let id = id_from_i64(sample_id)?;

    diesel::update(samples_dsl::samples.find(id))
        .set((
            samples_dsl::sample_rate.eq(i32::try_from(decoded.sample_rate).ok()),
            samples_dsl::channels.eq(Some(i32::from(decoded.channels))),
            samples_dsl::duration_ms.eq(Some(duration_ms)),
            samples_dsl::updated_at.eq(utc_now()),
        ))
        .execute(conn)?;

    if let Some(ref f) = format {
        diesel::update(samples_dsl::samples.find(id))
            .set(samples_dsl::format.eq(f))
            .execute(conn)?;
    }
    if let Some(b) = bit_depth {
        diesel::update(samples_dsl::samples.find(id))
            .set(samples_dsl::bit_depth.eq(b))
            .execute(conn)?;
    }

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
        let empty: [f32; 0] = [];
        assert_ne!(decoded.samples, empty);
        assert!(decoded.duration_ms() > 0.0);
        let _ = decoded.bit_depth_hint;
    }
}
