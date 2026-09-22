//! Zero-crossing search for selection edges (`Z` in the waveform pane).
//!
//! Clip edges that land mid-cycle click on playback. Nudging each edge to the
//! nearest frame where the summed signal crosses zero removes that click.

use crate::audio::decode::DecodedAudio;
use crate::ids::{f64_to_usize, usize_to_f64};

/// How far either side of a requested point we are willing to move, in seconds.
const SEARCH_RADIUS_SECS: f64 = 0.05;

/// Sum of all channels at `frame`, which is what the ear hears crossing zero.
fn frame_sum(audio: &DecodedAudio, frame: usize) -> f32 {
    let channels = usize::from(audio.channels.max(1));
    let Some(start) = frame.checked_mul(channels) else {
        return 0.0;
    };
    audio
        .samples
        .get(start..start.saturating_add(channels))
        .map_or(0.0, |slice| slice.iter().sum())
}

fn crosses(audio: &DecodedAudio, frame: usize, frames: usize) -> bool {
    let Some(next) = frame.checked_add(1) else {
        return false;
    };
    if next >= frames {
        return false;
    }
    let a = frame_sum(audio, frame);
    let b = frame_sum(audio, next);
    (a <= 0.0 && b > 0.0) || (a >= 0.0 && b < 0.0)
}

/// Nearest frame to `secs` where the summed signal changes sign.
///
/// Returns `secs` unchanged when nothing crosses within the search radius, so
/// the caller can apply this to every edge without special-casing silence.
#[must_use]
pub fn nearest(audio: &DecodedAudio, secs: f64) -> f64 {
    let frames = audio.frame_count();
    if frames < 2 || audio.sample_rate == 0 {
        return secs;
    }
    let rate = f64::from(audio.sample_rate);
    let target = f64_to_usize((secs.max(0.0) * rate).round()).min(frames.saturating_sub(1));
    let radius = f64_to_usize((SEARCH_RADIUS_SECS * rate).round()).max(1);

    for offset in 0..=radius {
        let forward = target.saturating_add(offset);
        if forward < frames && crosses(audio, forward, frames) {
            return usize_to_f64(forward) / rate;
        }
        let back = target.saturating_sub(offset);
        if crosses(audio, back, frames) {
            return usize_to_f64(back) / rate;
        }
    }
    secs
}

#[cfg(test)]
#[allow(
    clippy::as_conversions,
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation
)]
mod tests {
    use super::*;

    fn sine(rate: u32, secs: f64, hz: f64) -> DecodedAudio {
        let frames = f64_to_usize(secs * f64::from(rate));
        let samples = (0..frames)
            .map(|i| {
                let t = usize_to_f64(i) / f64::from(rate);
                (t * hz * std::f64::consts::TAU).sin() as f32
            })
            .collect();
        DecodedAudio {
            sample_rate: rate,
            channels: 1,
            bit_depth_hint: None,
            samples,
        }
    }

    #[test]
    fn snaps_to_a_crossing_of_a_sine() {
        let audio = sine(48_000, 0.5, 100.0);
        // A 100 Hz sine crosses zero every 5 ms, so a snapped edge lands on a
        // multiple of 0.005 s.
        let snapped = nearest(&audio, 0.1234);
        let steps = snapped / 0.005;
        assert!((steps - steps.round()).abs() < 0.05, "got {snapped}");
    }

    #[test]
    fn leaves_silence_alone() {
        let audio = DecodedAudio {
            sample_rate: 48_000,
            channels: 1,
            bit_depth_hint: None,
            samples: vec![0.0; 48_000],
        };
        assert!((nearest(&audio, 0.25) - 0.25).abs() < f64::EPSILON);
    }

    #[test]
    fn short_buffers_pass_through() {
        let audio = DecodedAudio {
            sample_rate: 48_000,
            channels: 1,
            bit_depth_hint: None,
            samples: vec![0.5],
        };
        assert!((nearest(&audio, 1.0) - 1.0).abs() < f64::EPSILON);
    }
}
