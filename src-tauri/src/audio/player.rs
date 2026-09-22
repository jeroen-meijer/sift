//! cpal preview playback engine.
//!
//! Decode happens on the control thread; the audio callback only reads a shared
//! interleaved f32 buffer and applies gain. Previous plays are interrupted by
//! dropping the old stream before starting a new one.

use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    Device, DeviceId, FromSample, Host, Sample, SampleFormat, SizedSample, Stream, StreamConfig,
};
use serde::Serialize;

use crate::audio::decode::{DecodedAudio, decode_file};
use crate::error::{AppError, AppResult};
use crate::ids::f64_to_usize;

#[derive(Debug, Clone, Serialize)]
pub struct OutputDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SamplePlayType {
    Loop,
    OneShot,
}

impl SamplePlayType {
    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s.map(str::to_ascii_lowercase).as_deref() {
            Some("loop") => Self::Loop,
            _ => Self::OneShot,
        }
    }
}

struct SharedPlayback {
    /// Interleaved f32 at the device sample rate / channel count.
    pcm: Arc<[f32]>,
    channels: usize,
    sample_rate: u32,
    /// Frame index into pcm.
    position: AtomicUsize,
    /// Loop window in frames. Playback wraps from `region_end` straight back to
    /// `region_start`, so a selected region loops with no gap and no crossfade.
    region_start: AtomicUsize,
    region_end: AtomicUsize,
    playing: AtomicBool,
    paused: AtomicBool,
    looping: AtomicBool,
    /// Linear gain as f32 bits.
    gain: AtomicU32,
}

impl SharedPlayback {
    fn gain_linear(&self) -> f32 {
        f32::from_bits(self.gain.load(Ordering::Relaxed))
    }
}

/// Thread-safe preview player owned by `AppState` behind a `Mutex`.
pub struct PlayerEngine {
    host: Host,
    /// None / "default" → system default output.
    device_id: Option<String>,
    gain_db: f32,
    loop_preview: bool,
    stream: Option<Stream>,
    shared: Option<Arc<SharedPlayback>>,
}

impl Default for PlayerEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl PlayerEngine {
    pub fn new() -> Self {
        Self {
            host: cpal::default_host(),
            device_id: None,
            gain_db: -6.0,
            loop_preview: true,
            stream: None,
            shared: None,
        }
    }

    pub fn list_devices(&self) -> AppResult<Vec<OutputDeviceInfo>> {
        let default_id = self
            .host
            .default_output_device()
            .and_then(|d| d.id().ok())
            .map(|id| id.to_string());

        let mut out = vec![OutputDeviceInfo {
            id: "default".into(),
            name: "Default".into(),
            is_default: true,
        }];

        let devices = self
            .host
            .output_devices()
            .map_err(|e| AppError::msg(format!("list output devices: {e}")))?;

        for device in devices {
            let id = device
                .id()
                .map_err(|e| AppError::msg(format!("device id: {e}")))?
                .to_string();
            let name = device
                .description()
                .map_or_else(|_| id.clone(), |d| d.name().to_string());
            let is_default = default_id.as_ref() == Some(&id);
            out.push(OutputDeviceInfo {
                id,
                name,
                is_default,
            });
        }
        Ok(out)
    }

    pub fn set_device(&mut self, id: &str) -> AppResult<()> {
        if id == "default" || id.is_empty() {
            self.device_id = None;
        } else {
            let device_id = DeviceId::from_str(id)
                .map_err(|e| AppError::msg(format!("invalid device id: {e}")))?;
            if self.host.device_by_id(&device_id).is_none() {
                // Fallback: match by name for older persisted settings.
                let found = self
                    .host
                    .output_devices()
                    .map_err(|e| AppError::msg(e.to_string()))?
                    .any(|d| {
                        d.description().is_ok_and(|desc| desc.name() == id)
                            || d.id().is_ok_and(|did| did.to_string() == id)
                    });
                if !found {
                    return Err(AppError::msg(format!("output device not found: {id}")));
                }
            }
            self.device_id = Some(id.to_string());
        }

        self.stop();
        Ok(())
    }

    pub fn set_gain_db(&mut self, db: f32) {
        self.gain_db = db.clamp(-60.0, 12.0);
        let linear = db_to_linear(self.gain_db);
        if let Some(shared) = &self.shared {
            shared.gain.store(linear.to_bits(), Ordering::Relaxed);
        }
    }

    pub fn set_loop_preview(&mut self, on: bool) {
        self.loop_preview = on;
        if !on && let Some(shared) = &self.shared {
            shared.looping.store(false, Ordering::Relaxed);
        }
    }

    #[allow(dead_code)]
    pub const fn loop_preview(&self) -> bool {
        self.loop_preview
    }

    #[allow(dead_code)]
    pub const fn gain_db(&self) -> f32 {
        self.gain_db
    }

    pub fn play_file(
        &mut self,
        path: &Path,
        start_secs: f64,
        sample_type: SamplePlayType,
        region_secs: Option<(f64, f64)>,
    ) -> AppResult<()> {
        let decoded = decode_file(path)?;
        self.play_decoded(&decoded, start_secs, sample_type, region_secs)
    }

    /// Play `decoded` from `start_secs`. `region_secs` limits playback to a
    /// window, which is what a waveform selection loops over.
    pub fn play_decoded(
        &mut self,
        decoded: &DecodedAudio,
        start_secs: f64,
        sample_type: SamplePlayType,
        region_secs: Option<(f64, f64)>,
    ) -> AppResult<()> {
        let device = self.resolve_device()?;
        let supported = device
            .default_output_config()
            .map_err(|e| AppError::msg(format!("default output config: {e}")))?;
        let out_channels = usize::from(supported.channels());
        let out_rate = supported.sample_rate();
        let sample_format = supported.sample_format();
        let config: StreamConfig = supported.into();

        let pcm = convert_for_device(decoded, out_channels, out_rate);
        let channels = out_channels.max(1);
        let frames = pcm.len().checked_div(channels).unwrap_or(0);
        let to_frame = |secs: f64| f64_to_usize(secs.max(0.0) * f64::from(out_rate)).min(frames);
        let region = region_secs.map_or((0, frames), |(start, end)| {
            let start_frame = to_frame(start);
            (start_frame, to_frame(end).max(start_frame))
        });
        let start_frame = to_frame(start_secs).max(region.0);
        let should_loop = self.loop_preview && sample_type == SamplePlayType::Loop;

        self.stop_stream_only();
        self.start_stream(
            pcm.into(),
            channels,
            out_rate,
            start_frame,
            region,
            should_loop,
            &device,
            &config,
            sample_format,
        )?;
        Ok(())
    }

    /// Retune the loop window of whatever is playing, without restarting it.
    pub fn set_region(&self, region_secs: Option<(f64, f64)>) {
        let Some(shared) = &self.shared else {
            return;
        };
        let frames = shared
            .pcm
            .len()
            .checked_div(shared.channels.max(1))
            .unwrap_or(0);
        let rate = f64::from(shared.sample_rate.max(1));
        let (start, end) = region_secs.map_or((0, frames), |(start, end)| {
            let start_frame = f64_to_usize(start.max(0.0) * rate).min(frames);
            let end_frame = f64_to_usize(end.max(0.0) * rate)
                .min(frames)
                .max(start_frame);
            (start_frame, end_frame)
        });
        shared.region_start.store(start, Ordering::Relaxed);
        shared.region_end.store(end, Ordering::Relaxed);
    }

    pub fn pause(&self) {
        if let Some(shared) = &self.shared {
            shared.paused.store(true, Ordering::Relaxed);
        }
    }

    pub fn resume(&mut self) -> AppResult<()> {
        let Some(shared) = self.shared.clone() else {
            return Err(AppError::msg("nothing to resume"));
        };
        let frames = shared
            .pcm
            .len()
            .checked_div(shared.channels.max(1))
            .unwrap_or(0);
        let region_start = shared.region_start.load(Ordering::Relaxed);
        let region_end = shared.region_end.load(Ordering::Relaxed).min(frames);
        let pos = shared.position.load(Ordering::Relaxed);
        if pos >= region_end {
            shared.position.store(region_start, Ordering::Relaxed);
        }
        shared.paused.store(false, Ordering::Relaxed);
        shared.playing.store(true, Ordering::Relaxed);

        if self.stream.is_none() {
            let device = self.resolve_device()?;
            let supported = device
                .default_output_config()
                .map_err(|e| AppError::msg(format!("default output config: {e}")))?;
            let sample_format = supported.sample_format();
            let config: StreamConfig = supported.into();
            let pos = shared.position.load(Ordering::Relaxed);
            let looping = shared.looping.load(Ordering::Relaxed);
            let region = (
                shared.region_start.load(Ordering::Relaxed),
                shared.region_end.load(Ordering::Relaxed),
            );
            self.start_stream(
                Arc::clone(&shared.pcm),
                shared.channels,
                shared.sample_rate,
                pos,
                region,
                looping,
                &device,
                &config,
                sample_format,
            )?;
        }
        Ok(())
    }

    pub fn stop(&mut self) {
        self.stop_stream_only();
        self.shared = None;
    }

    /// Current playhead in seconds, and whether audio is actively outputting.
    pub fn playback_state(&self) -> (f64, bool) {
        let Some(shared) = &self.shared else {
            return (0.0, false);
        };
        let channels = shared.channels.max(1);
        let frames = shared.pcm.len().checked_div(channels).unwrap_or(0);
        let pos = shared.position.load(Ordering::Relaxed);
        #[allow(
            clippy::as_conversions,
            clippy::cast_precision_loss,
            reason = "playhead position: frame index to seconds"
        )]
        let secs = if shared.sample_rate == 0 {
            0.0
        } else {
            pos as f64 / f64::from(shared.sample_rate)
        };
        let playing = shared.playing.load(Ordering::Relaxed)
            && !shared.paused.load(Ordering::Relaxed)
            && pos < frames;
        (secs, playing)
    }

    #[allow(dead_code)]
    pub fn seek(&self, secs: f64) {
        let Some(shared) = &self.shared else {
            return;
        };
        let frames = shared
            .pcm
            .len()
            .checked_div(shared.channels.max(1))
            .unwrap_or(0);
        let frame = f64_to_usize(secs.max(0.0) * f64::from(shared.sample_rate)).min(frames);
        shared.position.store(frame, Ordering::Relaxed);
        if frame < frames {
            shared.playing.store(true, Ordering::Relaxed);
        }
    }

    fn stop_stream_only(&mut self) {
        if let Some(shared) = &self.shared {
            shared.playing.store(false, Ordering::Relaxed);
        }
        self.stream = None;
    }

    fn resolve_device(&self) -> AppResult<Device> {
        match &self.device_id {
            None => self
                .host
                .default_output_device()
                .ok_or_else(|| AppError::msg("no default output device")),
            Some(id) => {
                if let Ok(device_id) = DeviceId::from_str(id)
                    && let Some(d) = self.host.device_by_id(&device_id)
                {
                    return Ok(d);
                }
                self.host
                    .output_devices()
                    .map_err(|e| AppError::msg(e.to_string()))?
                    .find(|d| {
                        d.description().is_ok_and(|desc| desc.name() == id.as_str())
                            || d.id().is_ok_and(|did| did.to_string() == *id)
                    })
                    .ok_or_else(|| AppError::msg(format!("output device not found: {id}")))
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn start_stream(
        &mut self,
        pcm: Arc<[f32]>,
        channels: usize,
        sample_rate: u32,
        start_frame: usize,
        region: (usize, usize),
        looping: bool,
        device: &Device,
        config: &StreamConfig,
        sample_format: SampleFormat,
    ) -> AppResult<()> {
        let shared = Arc::new(SharedPlayback {
            pcm,
            channels,
            sample_rate,
            position: AtomicUsize::new(start_frame),
            region_start: AtomicUsize::new(region.0),
            region_end: AtomicUsize::new(region.1),
            playing: AtomicBool::new(true),
            paused: AtomicBool::new(false),
            looping: AtomicBool::new(looping),
            gain: AtomicU32::new(db_to_linear(self.gain_db).to_bits()),
        });

        let err_fn = |e| eprintln!("cpal stream error: {e}");
        let stream = match sample_format {
            SampleFormat::F32 => build_stream::<f32>(device, config, Arc::clone(&shared), err_fn)?,
            SampleFormat::I16 => build_stream::<i16>(device, config, Arc::clone(&shared), err_fn)?,
            SampleFormat::U16 => build_stream::<u16>(device, config, Arc::clone(&shared), err_fn)?,
            SampleFormat::I32 => build_stream::<i32>(device, config, Arc::clone(&shared), err_fn)?,
            SampleFormat::U32 => build_stream::<u32>(device, config, Arc::clone(&shared), err_fn)?,
            other => {
                return Err(AppError::msg(format!(
                    "unsupported sample format: {other:?}"
                )));
            }
        };
        stream
            .play()
            .map_err(|e| AppError::msg(format!("stream play: {e}")))?;
        self.shared = Some(shared);
        self.stream = Some(stream);
        Ok(())
    }
}

fn build_stream<T>(
    device: &Device,
    config: &StreamConfig,
    shared: Arc<SharedPlayback>,
    err_fn: impl FnMut(cpal::Error) + Send + 'static,
) -> AppResult<Stream>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = usize::from(config.channels);
    device
        .build_output_stream(
            *config,
            move |data: &mut [T], _| {
                write_output(data, channels, &shared);
            },
            err_fn,
            None,
        )
        .map_err(|e| AppError::msg(format!("build output stream: {e}")))
}

#[allow(
    clippy::arithmetic_side_effects,
    reason = "audio callback: float gain multiply, indices use saturating math"
)]
fn write_output<T>(data: &mut [T], out_channels: usize, shared: &SharedPlayback)
where
    T: Sample + FromSample<f32>,
{
    let gain = shared.gain_linear();
    let src_ch = shared.channels.max(1);
    let frames_total = shared.pcm.len().checked_div(src_ch).unwrap_or(0);
    let out_ch = out_channels.max(1);

    if !shared.playing.load(Ordering::Relaxed) || shared.paused.load(Ordering::Relaxed) {
        for s in data.iter_mut() {
            *s = T::EQUILIBRIUM;
        }
        return;
    }

    let mut pos = shared.position.load(Ordering::Relaxed);
    let looping = shared.looping.load(Ordering::Relaxed);
    let region_start = shared
        .region_start
        .load(Ordering::Relaxed)
        .min(frames_total);
    let region_end = shared
        .region_end
        .load(Ordering::Relaxed)
        .min(frames_total)
        .max(region_start);
    let mut finished = false;

    for frame in data.chunks_mut(out_ch) {
        if !finished && pos >= region_end {
            if looping && region_end > region_start {
                pos = region_start;
            } else {
                finished = true;
                shared.playing.store(false, Ordering::Relaxed);
            }
        }
        if finished {
            for slot in frame.iter_mut() {
                *slot = T::EQUILIBRIUM;
            }
            continue;
        }

        let base = pos.saturating_mul(src_ch);
        for (c, slot) in frame.iter_mut().enumerate() {
            let offset = if c < src_ch {
                c
            } else {
                c.checked_rem(src_ch).unwrap_or(0)
            };
            let src = shared
                .pcm
                .get(base.saturating_add(offset))
                .copied()
                .unwrap_or(0.0);
            *slot = T::from_sample(src * gain);
        }
        pos = pos.saturating_add(1);
    }
    shared.position.store(pos, Ordering::Relaxed);
}

fn db_to_linear(db: f32) -> f32 {
    10f32.powf(db / 20.0)
}

/// Resample + channel-map decoded PCM to the device layout (linear interpolation).
#[allow(
    clippy::arithmetic_side_effects,
    clippy::as_conversions,
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    reason = "linear-interpolation resampler: float DSP with bounds-checked sample reads"
)]
fn convert_for_device(decoded: &DecodedAudio, out_channels: usize, out_rate: u32) -> Vec<f32> {
    let in_ch = usize::from(decoded.channels.max(1));
    let in_rate = decoded.sample_rate.max(1);
    let out_rate = out_rate.max(1);
    let in_frames = decoded.frame_count();
    if in_frames == 0 {
        return Vec::new();
    }

    let out_frames = if in_rate == out_rate {
        in_frames
    } else {
        let scaled = (in_frames as u64)
            .saturating_mul(u64::from(out_rate))
            .saturating_add(u64::from(in_rate).saturating_sub(1))
            .checked_div(u64::from(in_rate))
            .unwrap_or(0);
        usize::try_from(scaled).unwrap_or(usize::MAX)
    };

    let out_ch = out_channels.max(1);
    let Some(total) = out_frames.checked_mul(out_ch) else {
        return Vec::new();
    };
    let mut out = vec![0.0f32; total];
    let ratio = f64::from(in_rate) / f64::from(out_rate);
    let last_frame = in_frames.saturating_sub(1);

    for (of, frame) in out.chunks_mut(out_ch).enumerate() {
        let src_pos = of as f64 * ratio;
        let i0 = f64_to_usize(src_pos.floor()).min(last_frame);
        let i1 = i0.saturating_add(1).min(last_frame);
        let frac = (src_pos - i0 as f64) as f32;

        for (oc, slot) in frame.iter_mut().enumerate() {
            let ic = if in_ch == 1 {
                0
            } else {
                oc.min(in_ch.saturating_sub(1))
            };
            let s0 = sample_at(&decoded.samples, i0, in_ch, ic);
            let s1 = sample_at(&decoded.samples, i1, in_ch, ic);
            *slot = (s1 - s0).mul_add(frac, s0);
        }
    }
    out
}

fn sample_at(samples: &[f32], frame: usize, channels: usize, channel: usize) -> f32 {
    frame
        .checked_mul(channels)
        .and_then(|base| base.checked_add(channel))
        .and_then(|idx| samples.get(idx))
        .copied()
        .unwrap_or(0.0)
}
