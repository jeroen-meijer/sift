//! Peakfile cache for waveform drawing.
//!
//! Binary layout (`{sample_id}.peaks`):
//! - magic: `SFTP` (4 bytes)
//! - version: u32 LE (= 6)
//! - channels: u32 LE
//! - `sample_rate`: u32 LE
//! - `duration_ms`: f64 LE
//! - `bucket_count`: u32 LE
//! - peaks: `bucket_count * channels * 2` f32 LE values
//!   per bucket, per channel: min, max
//! - colors: `bucket_count * 3` u8 RGB values (bass→R, mid→G, treble→B)

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use moodbar_analysis::{GenerateOptions, NormalizeMode, Theme, analyze_pcm_mono};
use serde::Serialize;

use crate::audio::decode::{DecodedAudio, decode_file};
use crate::error::{AppError, AppResult};
use crate::paths::AppPaths;

const MAGIC: &[u8; 4] = b"SFTP";
/// v6: mid/treble cut at 6 kHz so amen/snare body stays mid instead of a flat
/// treble wash (v5 used 3.5 kHz).
const VERSION: u32 = 6;

/// Peak buffer ready for IPC / Canvas drawing.
#[derive(Debug, Clone, Serialize)]
pub struct PeakData {
    pub channels: u16,
    pub sample_rate: u32,
    pub duration_ms: f64,
    /// Flat array: for each bucket, for each channel: min, max.
    pub peaks: Vec<f32>,
    pub bucket_count: usize,
    /// Flat Classic moodbar weights (`bucket_count * 3` bytes): bass→R, mid→G,
    /// treble→B. The UI remaps these through theme `--color-wave-*` band hues.
    pub colors: Vec<u8>,
}

fn peak_path(peaks_dir: &Path, sample_id: i64) -> PathBuf {
    peaks_dir.join(format!("{sample_id}.peaks"))
}

fn write_peakfile(path: &Path, data: &PeakData) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = File::create(path)?;
    f.write_all(MAGIC)?;
    f.write_all(&VERSION.to_le_bytes())?;
    f.write_all(&(u32::from(data.channels)).to_le_bytes())?;
    f.write_all(&data.sample_rate.to_le_bytes())?;
    f.write_all(&data.duration_ms.to_le_bytes())?;
    let bucket_count =
        u32::try_from(data.bucket_count).map_err(|_| AppError::msg("bucket count out of range"))?;
    f.write_all(&bucket_count.to_le_bytes())?;
    for v in &data.peaks {
        f.write_all(&v.to_le_bytes())?;
    }
    if data.colors.len() != data.bucket_count.saturating_mul(3) {
        return Err(AppError::msg("spectral color length mismatch"));
    }
    f.write_all(&data.colors)?;
    Ok(())
}

fn read_peakfile(path: &Path, expected_buckets: Option<usize>) -> AppResult<Option<PeakData>> {
    if !path.exists() {
        return Ok(None);
    }
    let mut f = File::open(path)?;
    let mut magic = [0u8; 4];
    f.read_exact(&mut magic)?;
    if &magic != MAGIC {
        return Ok(None);
    }
    let mut buf4 = [0u8; 4];
    f.read_exact(&mut buf4)?;
    let version = u32::from_le_bytes(buf4);
    if version != VERSION {
        return Ok(None);
    }
    f.read_exact(&mut buf4)?;
    let channels = u16::try_from(u32::from_le_bytes(buf4)).unwrap_or(1);
    f.read_exact(&mut buf4)?;
    let sample_rate = u32::from_le_bytes(buf4);
    let mut buf8 = [0u8; 8];
    f.read_exact(&mut buf8)?;
    let duration_ms = f64::from_le_bytes(buf8);
    f.read_exact(&mut buf4)?;
    let bucket_count = usize::try_from(u32::from_le_bytes(buf4))
        .map_err(|_| AppError::msg("bucket count out of range"))?;

    if let Some(expected) = expected_buckets
        && bucket_count != expected
    {
        return Ok(None);
    }

    let n = bucket_count
        .checked_mul(usize::from(channels))
        .and_then(|x| x.checked_mul(2))
        .ok_or_else(|| AppError::msg("peakfile size overflow"))?;
    let mut peaks = Vec::with_capacity(n);
    let mut f32buf = [0u8; 4];
    for _ in 0..n {
        f.read_exact(&mut f32buf)?;
        peaks.push(f32::from_le_bytes(f32buf));
    }

    let color_len = bucket_count
        .checked_mul(3)
        .ok_or_else(|| AppError::msg("peakfile color size overflow"))?;
    let mut colors = vec![0u8; color_len];
    f.read_exact(&mut colors)?;

    Ok(Some(PeakData {
        channels,
        sample_rate,
        duration_ms,
        peaks,
        bucket_count,
        colors,
    }))
}

fn peak_index_overflow() -> AppError {
    AppError::msg("peak index overflow")
}

/// Downmix interleaved PCM to mono for spectral analysis.
fn mix_to_mono(decoded: &DecodedAudio) -> Vec<f32> {
    let ch = usize::from(decoded.channels.max(1));
    if ch == 1 {
        return decoded.samples.clone();
    }
    let frames = decoded.frame_count();
    let mut mono = Vec::with_capacity(frames);
    #[allow(
        clippy::as_conversions,
        clippy::cast_precision_loss,
        reason = "channel count is a tiny u16"
    )]
    let inv = 1.0f32 / ch as f32;
    for frame in 0..frames {
        let mut sum = 0.0f32;
        for c in 0..ch {
            let idx = frame.saturating_mul(ch).saturating_add(c);
            sum += decoded.samples.get(idx).copied().unwrap_or(0.0);
        }
        mono.push(sum * inv);
    }
    mono
}

/// Pick an FFT size so short clips still produce enough spectral frames to lerp.
fn adaptive_fft_size(mono_frames: usize) -> usize {
    // Aim for ~24 hops across the file at hop = fft/2 → fft ≈ frames/12.
    let target = mono_frames
        .checked_div(12)
        .unwrap_or(256)
        .max(256)
        .next_power_of_two()
        .min(2048);
    target.max(256)
}

/// Linear interpolate Classic band-weight RGB between moodbar frames onto `buckets`.
#[allow(
    clippy::as_conversions,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::suboptimal_flops,
    reason = "display RGB from floats; precision is irrelevant"
)]
fn resample_colors(frames: &[[u8; 3]], buckets: usize) -> Vec<u8> {
    let mut out = vec![0u8; buckets.saturating_mul(3)];
    if buckets == 0 || frames.is_empty() {
        return out;
    }
    if frames.len() == 1 {
        let rgb = frames.first().copied().unwrap_or([0, 0, 0]);
        for b in 0..buckets {
            let base = b.saturating_mul(3);
            if let Some(r) = out.get_mut(base) {
                *r = rgb[0];
            }
            if let Some(g) = out.get_mut(base.saturating_add(1)) {
                *g = rgb[1];
            }
            if let Some(bl) = out.get_mut(base.saturating_add(2)) {
                *bl = rgb[2];
            }
        }
        return out;
    }

    let last_src = frames.len().saturating_sub(1);
    let last_dst = buckets.saturating_sub(1).max(1);
    for b in 0..buckets {
        let t = b as f32 / last_dst as f32 * last_src as f32;
        let i0 = t.floor() as usize;
        let i1 = i0.saturating_add(1).min(last_src);
        let frac = t - i0 as f32;
        let a = frames.get(i0).copied().unwrap_or([0, 0, 0]);
        let c = frames.get(i1).copied().unwrap_or([0, 0, 0]);
        let rgb = [
            (f32::from(a[0]) + (f32::from(c[0]) - f32::from(a[0])) * frac).round() as u8,
            (f32::from(a[1]) + (f32::from(c[1]) - f32::from(a[1])) * frac).round() as u8,
            (f32::from(a[2]) + (f32::from(c[2]) - f32::from(a[2])) * frac).round() as u8,
        ];
        let base = b.saturating_mul(3);
        if let Some(r) = out.get_mut(base) {
            *r = rgb[0];
        }
        if let Some(g) = out.get_mut(base.saturating_add(1)) {
            *g = rgb[1];
        }
        if let Some(bl) = out.get_mut(base.saturating_add(2)) {
            *bl = rgb[2];
        }
    }

    // Light 3-tap smooth so residual steps from few spectral frames soften.
    smooth_colors_inplace(&mut out, buckets);
    out
}

#[allow(
    clippy::as_conversions,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "averaged u8 RGB"
)]
fn smooth_colors_inplace(colors: &mut [u8], buckets: usize) {
    if buckets < 3 {
        return;
    }
    let snapshot = colors.to_vec();
    for b in 1..buckets.saturating_sub(1) {
        for c in 0..3 {
            let i = b.saturating_mul(3).saturating_add(c);
            let left = snapshot
                .get(b.saturating_sub(1).saturating_mul(3).saturating_add(c))
                .copied()
                .unwrap_or(0);
            let mid = snapshot.get(i).copied().unwrap_or(0);
            let right = snapshot
                .get(b.saturating_add(1).saturating_mul(3).saturating_add(c))
                .copied()
                .unwrap_or(0);
            let avg = (u16::from(left)
                .saturating_add(u16::from(mid))
                .saturating_add(u16::from(mid))
                .saturating_add(u16::from(right)))
                / 4;
            if let Some(slot) = colors.get_mut(i) {
                *slot = avg as u8;
            }
        }
    }
}

/// Bass / mid / treble energy → Classic RGB weights (R/G/B) for theme remapping in the UI.
fn generate_spectral_colors(decoded: &DecodedAudio, buckets: usize) -> Vec<u8> {
    if buckets == 0 || decoded.sample_rate == 0 || decoded.frame_count() == 0 {
        return vec![0u8; buckets.saturating_mul(3)];
    }
    let mono = mix_to_mono(decoded);
    let fft_size = adaptive_fft_size(mono.len());
    let options = GenerateOptions {
        theme: Theme::Classic,
        // Keep band ratios across the file (not per-band peaks → white wash).
        normalize_mode: NormalizeMode::GlobalPeak,
        // Musical cuts for sample browsing:
        // - <200 Hz: sub / 808 / kick body
        // - 200–6 kHz: vocals, snare body, most melodic content
        // - >6 kHz: air / hats (amen was ~75% treble at 3.5 kHz)
        low_cut_hz: 200.0,
        mid_cut_hz: 6000.0,
        band_edges_hz: vec![200.0, 6000.0],
        fft_size,
        max_target_frames: Some(buckets.max(1)),
        ..GenerateOptions::default()
    };
    let analysis = analyze_pcm_mono(decoded.sample_rate, &mono, &options);
    resample_colors(&analysis.colors, buckets)
}

/// Build min/max peaks from decoded PCM, with per-bucket spectral RGB.
pub fn generate_peaks(decoded: &DecodedAudio, buckets: usize) -> AppResult<PeakData> {
    let channels = decoded.channels.max(1);
    let frames = decoded.frame_count();
    if frames == 0 || buckets == 0 {
        return Err(AppError::msg("cannot generate peaks from empty audio"));
    }

    let ch = usize::from(channels);
    let total = buckets
        .checked_mul(ch)
        .and_then(|n| n.checked_mul(2))
        .ok_or_else(peak_index_overflow)?;
    let mut peaks = vec![0.0f32; total];

    for b in 0..buckets {
        let start = b
            .checked_mul(frames)
            .and_then(|n| n.checked_div(buckets))
            .ok_or_else(peak_index_overflow)?;
        let end = b
            .checked_add(1)
            .and_then(|n| n.checked_mul(frames))
            .and_then(|n| n.checked_div(buckets))
            .ok_or_else(peak_index_overflow)?
            .max(start.saturating_add(1))
            .min(frames);

        for c in 0..ch {
            let mut min_v = f32::INFINITY;
            let mut max_v = f32::NEG_INFINITY;
            for frame in start..end {
                let idx = frame
                    .checked_mul(ch)
                    .and_then(|n| n.checked_add(c))
                    .ok_or_else(peak_index_overflow)?;
                let s = *decoded.samples.get(idx).ok_or_else(peak_index_overflow)?;
                min_v = min_v.min(s);
                max_v = max_v.max(s);
            }
            if !min_v.is_finite() {
                min_v = 0.0;
            }
            if !max_v.is_finite() {
                max_v = 0.0;
            }
            let base = b
                .checked_mul(ch)
                .and_then(|n| n.checked_add(c))
                .and_then(|n| n.checked_mul(2))
                .ok_or_else(peak_index_overflow)?;
            let hi = base.checked_add(1).ok_or_else(peak_index_overflow)?;
            *peaks.get_mut(base).ok_or_else(peak_index_overflow)? = min_v;
            *peaks.get_mut(hi).ok_or_else(peak_index_overflow)? = max_v;
        }
    }

    let colors = generate_spectral_colors(decoded, buckets);

    Ok(PeakData {
        channels,
        sample_rate: decoded.sample_rate,
        duration_ms: decoded.duration_ms(),
        peaks,
        bucket_count: buckets,
        colors,
    })
}

/// Return cached peaks or decode + generate + write `{sample_id}.peaks`.
pub fn ensure_peaks(
    paths: &AppPaths,
    sample_id: i64,
    path: &Path,
    buckets_row: usize,
) -> AppResult<PeakData> {
    let cache = peak_path(&paths.peaks_dir, sample_id);
    let start = std::time::Instant::now();
    if let Some(cached) = read_peakfile(&cache, Some(buckets_row))? {
        crate::profile_log::event(
            "peaks.cache_hit",
            start.elapsed(),
            &format!("id={sample_id} buckets={buckets_row}"),
        );
        return Ok(cached);
    }

    let decode_start = std::time::Instant::now();
    let decoded = decode_file(path)?;
    crate::profile_log::event(
        "peaks.decode",
        decode_start.elapsed(),
        &format!(
            "id={sample_id} frames={} ch={}",
            decoded.frame_count(),
            decoded.channels
        ),
    );

    let gen_start = std::time::Instant::now();
    let data = generate_peaks(&decoded, buckets_row)?;
    crate::profile_log::event(
        "peaks.generate",
        gen_start.elapsed(),
        &format!("id={sample_id} buckets={buckets_row}"),
    );

    let write_start = std::time::Instant::now();
    write_peakfile(&cache, &data)?;
    crate::profile_log::event(
        "peaks.write",
        write_start.elapsed(),
        &format!("id={sample_id}"),
    );
    crate::profile_log::event(
        "peaks.cache_miss",
        start.elapsed(),
        &format!("id={sample_id} buckets={buckets_row}"),
    );
    Ok(data)
}

/// Default bucket count for row / generic peaks IPC.
pub const DEFAULT_BUCKETS: usize = 1024;

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn sine(rate: u32, secs: f32, hz: f32) -> DecodedAudio {
        #[allow(
            clippy::as_conversions,
            clippy::cast_possible_truncation,
            clippy::cast_precision_loss,
            clippy::cast_sign_loss,
            reason = "test fixture sizes"
        )]
        let n = (rate as f32 * secs) as usize;
        let samples: Vec<f32> = (0..n)
            .map(|i| {
                #[allow(clippy::as_conversions, clippy::cast_precision_loss)]
                let t = i as f32 / rate as f32;
                (2.0 * std::f32::consts::PI * hz * t).sin() * 0.8
            })
            .collect();
        DecodedAudio {
            sample_rate: rate,
            channels: 1,
            bit_depth_hint: None,
            samples,
        }
    }

    fn avg_rgb(colors: &[u8], start: usize, end: usize) -> [f32; 3] {
        let mut sum = [0.0f32; 3];
        let mut count = 0.0f32;
        for i in start..end {
            let base = i.saturating_mul(3);
            sum[0] += f32::from(colors.get(base).copied().unwrap_or(0));
            sum[1] += f32::from(colors.get(base.saturating_add(1)).copied().unwrap_or(0));
            sum[2] += f32::from(colors.get(base.saturating_add(2)).copied().unwrap_or(0));
            count += 1.0;
        }
        [sum[0] / count, sum[1] / count, sum[2] / count]
    }

    #[test]
    fn bass_mid_treble_map_to_rgb_channels() {
        let rate = 44_100;
        let mut samples = Vec::new();
        samples.extend(sine(rate, 0.4, 80.0).samples);
        samples.extend(sine(rate, 0.4, 1000.0).samples);
        samples.extend(sine(rate, 0.4, 6000.0).samples);
        let audio = DecodedAudio {
            sample_rate: rate,
            channels: 1,
            bit_depth_hint: None,
            samples,
        };
        let peaks = generate_peaks(&audio, 96).expect("peaks");
        assert_eq!(peaks.colors.len(), 96 * 3);
        let third = peaks.bucket_count / 3;
        let low = avg_rgb(&peaks.colors, 0, third);
        let mid = avg_rgb(&peaks.colors, third, third * 2);
        let high = avg_rgb(&peaks.colors, third * 2, peaks.bucket_count);
        assert!(
            low[0] > low[1] && low[0] > low[2],
            "bass should be red-dominant: {low:?}"
        );
        assert!(
            mid[1] > mid[0] && mid[1] > mid[2],
            "mids should be green-dominant: {mid:?}"
        );
        assert!(
            high[2] > high[0] && high[2] > high[1],
            "treble should be blue-dominant: {high:?}"
        );
    }

    #[test]
    fn short_clip_colors_are_not_huge_solid_blocks() {
        // ~150 ms snare-like length: without lerp this stretches ~a few frames
        // into multi-hundred-bucket solid slabs.
        let audio = sine(44_100, 0.15, 200.0);
        let peaks = generate_peaks(&audio, 256).expect("peaks");
        assert_eq!(peaks.colors.len(), 256 * 3);
        let mut changes = 0u32;
        for b in 1..peaks.bucket_count {
            let prev = b.saturating_sub(1).saturating_mul(3);
            let cur = b.saturating_mul(3);
            let same = peaks.colors.get(prev..prev.saturating_add(3))
                == peaks.colors.get(cur..cur.saturating_add(3));
            if !same {
                changes = changes.saturating_add(1);
            }
        }
        assert!(
            changes > 4,
            "expected lerped variation across a short clip, got {changes} changes"
        );
    }

    #[test]
    fn peakfile_roundtrip_keeps_colors() {
        let dir = tempfile::tempdir().expect("temp");
        let audio = sine(22_050, 0.2, 440.0);
        let data = generate_peaks(&audio, 64).expect("peaks");
        let path = dir.path().join("1.peaks");
        write_peakfile(&path, &data).expect("write");
        let loaded = read_peakfile(&path, Some(64))
            .expect("read")
            .expect("present");
        assert_eq!(loaded.bucket_count, 64);
        assert_eq!(loaded.colors, data.colors);
        assert_eq!(loaded.peaks.len(), data.peaks.len());
    }

    fn write_ppm_strip(path: &Path, colors: &[u8], buckets: usize, height: usize) {
        use std::fmt::Write as _;
        let width = buckets.max(1);
        let mut body = String::new();
        for _y in 0..height {
            for x in 0..width {
                let base = x.saturating_mul(3);
                let r = colors.get(base).copied().unwrap_or(0);
                let g = colors.get(base.saturating_add(1)).copied().unwrap_or(0);
                let b = colors.get(base.saturating_add(2)).copied().unwrap_or(0);
                let _ = write!(body, "{r} {g} {b} ");
            }
            body.push('\n');
        }
        let header = format!("P3\n{width} {height}\n255\n");
        fs::write(path, header + &body).expect("write ppm");
    }

    /// `GlobalPeak`: a pure bass tone must not wash to near-white Classic RGB.
    #[test]
    fn pure_bass_tone_is_red_dominant_not_white() {
        let audio = sine(44_100, 0.5, 70.0);
        let peaks = generate_peaks(&audio, 128).expect("peaks");
        let mid = avg_rgb(&peaks.colors, 16, 112);
        assert!(
            mid[0] > mid[1] * 1.8 && mid[0] > mid[2] * 1.8,
            "70 Hz should be bass/red dominant, got {mid:?}"
        );
        let near_white = mid[0] > 200.0 && mid[1] > 200.0 && mid[2] > 200.0;
        assert!(!near_white, "bass tone washed to white: {mid:?}");
    }

    /// Real library fixtures: 808 bass-led, vocal mid-led, amen not flat treble.
    #[test]
    fn example_samples_have_distinct_spectral_shapes() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../example_samples");
        let eight = root.join("limbowrld_drumkit/808s/If u Swag 808 ._.`.wav");
        let vocal =
            root.join("foushee_vocals/runs/FOUSHEE_vocal_run_clean_jazzy_harmony_87_Bmaj.wav");
        let amen = root.join("amen_breaks/cw_amen_updown.wav");
        if !eight.is_file() || !vocal.is_file() || !amen.is_file() {
            eprintln!("skip: example samples missing");
            return;
        }

        let eight_peaks =
            generate_peaks(&decode_file(&eight).expect("808"), 256).expect("808 peaks");
        let vocal_peaks =
            generate_peaks(&decode_file(&vocal).expect("vocal"), 256).expect("vocal peaks");
        let amen_peaks =
            generate_peaks(&decode_file(&amen).expect("amen"), 256).expect("amen peaks");

        let share = |rgb: [f32; 3], i: usize| rgb[i] / (rgb[0] + rgb[1] + rgb[2]).max(1.0);
        let end = |n: usize| (n / 8).max(8);

        let a808 = avg_rgb(&eight_peaks.colors, 0, end(eight_peaks.bucket_count));
        let avoc = avg_rgb(&vocal_peaks.colors, 0, end(vocal_peaks.bucket_count));
        let amen_avg = avg_rgb(&amen_peaks.colors, 0, amen_peaks.bucket_count);

        assert!(
            share(a808, 0) > 0.7,
            "808 attack should be bass-led, rgb={a808:?}"
        );
        assert!(
            share(avoc, 1) > 0.5 && share(avoc, 0) < 0.2,
            "vocal should be mid-led with little bass, rgb={avoc:?}"
        );

        let amen_mid = share(amen_avg, 1);
        let amen_treble = share(amen_avg, 2);
        assert!(
            amen_mid > 0.35,
            "amen should carry substantial mid (snare body), rgb={amen_avg:?}"
        );
        assert!(
            amen_treble < 0.55,
            "amen must not wash to flat treble/blue, rgb={amen_avg:?}"
        );
        // Not a single-band strip: mid and treble both matter for a drum break.
        assert!(
            amen_mid > 0.15 && amen_treble > 0.15,
            "amen should mix mid+treble over time, rgb={amen_avg:?}"
        );

        let mut mid_dom = 0u32;
        let mut treble_dom = 0u32;
        for i in 0..amen_peaks.bucket_count {
            let base = i.saturating_mul(3);
            let r = i32::from(amen_peaks.colors.get(base).copied().unwrap_or(0));
            let g = i32::from(
                amen_peaks
                    .colors
                    .get(base.saturating_add(1))
                    .copied()
                    .unwrap_or(0),
            );
            let b = i32::from(
                amen_peaks
                    .colors
                    .get(base.saturating_add(2))
                    .copied()
                    .unwrap_or(0),
            );
            if g >= r && g >= b {
                mid_dom = mid_dom.saturating_add(1);
            } else if b >= r && b >= g {
                treble_dom = treble_dom.saturating_add(1);
            }
        }
        assert!(
            mid_dom > u32::try_from(amen_peaks.bucket_count / 4).unwrap_or(0),
            "amen should have many mid-dominant buckets, mid_dom={mid_dom} treble_dom={treble_dom}"
        );

        let out = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../testdata/spectral-fixtures");
        let _ = fs::create_dir_all(&out);
        write_ppm_strip(
            &out.join("808-classic-weights.ppm"),
            &eight_peaks.colors,
            eight_peaks.bucket_count,
            24,
        );
        write_ppm_strip(
            &out.join("vocal-classic-weights.ppm"),
            &vocal_peaks.colors,
            vocal_peaks.bucket_count,
            24,
        );
        write_ppm_strip(
            &out.join("amen-classic-weights.ppm"),
            &amen_peaks.colors,
            amen_peaks.bucket_count,
            24,
        );
    }
}
