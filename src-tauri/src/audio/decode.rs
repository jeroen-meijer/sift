use std::fs::File;
use std::path::Path;

use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, TrackType};
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

/// Technical facts about decoded audio, kept after the PCM itself is dropped.
#[derive(Debug, Clone, Copy)]
pub struct TechInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth_hint: Option<u32>,
    pub duration_ms: f64,
}

impl DecodedAudio {
    pub fn tech(&self) -> TechInfo {
        TechInfo {
            sample_rate: self.sample_rate,
            channels: self.channels,
            bit_depth_hint: self.bit_depth_hint,
            duration_ms: self.duration_ms(),
        }
    }
}

/// Average all channels into one mono signal.
pub fn to_mono(pcm: &DecodedAudio) -> Vec<f32> {
    let ch = usize::from(pcm.channels.max(1));
    if ch == 1 {
        return pcm.samples.clone();
    }
    pcm.samples.chunks_exact(ch).map(frame_mean).collect()
}

#[allow(
    clippy::arithmetic_side_effects,
    clippy::as_conversions,
    clippy::cast_precision_loss,
    reason = "channel downmix: float average over a fixed-size frame"
)]
fn frame_mean(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    frame.iter().sum::<f32>() / frame.len() as f32
}

/// A probed file with its decoder ready, before any packet is decoded.
///
/// Callers can look at `num_frames` / `channels` to size buffers or take a
/// large-file permit before [`decode_all`] allocates PCM.
pub struct OpenedAudio {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn AudioDecoder>,
    track_id: u32,
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth_hint: Option<u32>,
    /// Playable frame count from the container, when it states one.
    pub num_frames: Option<u64>,
}

impl OpenedAudio {
    /// Interleaved sample count (`frames * channels`) when the frame count is known.
    pub fn expected_samples(&self) -> Option<u64> {
        self.num_frames
            .and_then(|f| f.checked_mul(u64::from(self.channels)))
    }
}

/// Probe a file and build its decoder. Reads headers only.
pub fn open_audio(path: &Path) -> AppResult<OpenedAudio> {
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

    let format = symphonia::default::get_probe()
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

    let decoder = symphonia::default::get_codecs()
        .make_audio_decoder(&audio_params, &AudioDecoderOptions::default())
        .map_err(|e| AppError::msg(format!("decoder init failed: {e}")))?;

    Ok(OpenedAudio {
        format,
        decoder,
        track_id: track.id,
        sample_rate,
        channels,
        bit_depth_hint,
        num_frames: track.num_frames,
    })
}

/// Decode every packet of an opened file to interleaved f32 PCM.
pub fn decode_all(opened: OpenedAudio) -> AppResult<DecodedAudio> {
    let OpenedAudio {
        mut format,
        mut decoder,
        track_id,
        sample_rate,
        channels,
        bit_depth_hint,
        num_frames,
    } = opened;

    // Exact capacity when the container states a length: no doubling growth,
    // no realloc copies of a large buffer.
    let expected = num_frames
        .and_then(|f| usize::try_from(f).ok())
        .and_then(|f| f.checked_mul(usize::from(channels)));
    let mut samples: Vec<f32> = Vec::with_capacity(expected.unwrap_or(0));
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
        return Err(AppError::msg("no PCM decoded"));
    }

    Ok(DecodedAudio {
        sample_rate,
        channels,
        bit_depth_hint,
        samples,
    })
}

/// Decode an audio file to interleaved f32 PCM via Symphonia.
pub fn decode_file(path: &Path) -> AppResult<DecodedAudio> {
    decode_all(open_audio(path)?).map_err(|e| AppError::msg(format!("{e} ({})", path.display())))
}

/// Persist technical columns in one UPDATE.
pub fn write_technical_info(
    conn: &mut SqliteConnection,
    sample_id: i64,
    path: &Path,
    tech: &TechInfo,
) -> AppResult<()> {
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    let bit_depth = tech.bit_depth_hint.and_then(|b| i32::try_from(b).ok());
    let id = id_from_i64(sample_id)?;

    diesel::update(samples_dsl::samples.find(id))
        .set((
            samples_dsl::sample_rate.eq(i32::try_from(tech.sample_rate).ok()),
            samples_dsl::channels.eq(Some(i32::from(tech.channels))),
            samples_dsl::duration_ms.eq(Some(tech.duration_ms)),
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn decode_band_probe_wav() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../testdata/spectral-fixtures/band-probe.wav");
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
