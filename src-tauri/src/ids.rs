//! Checked integer conversions for Diesel (`i32`) ↔ IPC/JS (`i64`) boundaries.
//! Prefer these over `as` casts so `clippy::as_conversions` stays deny.

use crate::error::{AppError, AppResult};

/// Diesel row id → IPC / serde `i64`.
#[must_use]
pub fn id_to_i64(id: i32) -> i64 {
    i64::from(id)
}

/// IPC / serde `i64` → Diesel row id.
pub fn id_from_i64(id: i64) -> AppResult<i32> {
    i32::try_from(id).map_err(|_| AppError::msg(format!("id out of range: {id}")))
}

/// Non-negative count / size that fits in `i64` from `usize`.
#[allow(dead_code, reason = "conversion helper kept for the ids API surface")]
pub fn usize_to_i64(n: usize) -> AppResult<i64> {
    i64::try_from(n).map_err(|_| AppError::msg(format!("usize too large for i64: {n}")))
}

/// Buffer length / channel count checked into `usize`.
#[allow(dead_code, reason = "conversion helper kept for the ids API surface")]
pub fn i64_to_usize(n: i64) -> AppResult<usize> {
    usize::try_from(n).map_err(|_| AppError::msg(format!("i64 out of usize range: {n}")))
}

/// Audio channel / rate values stored as Diesel `Integer`.
#[allow(dead_code, reason = "conversion helper kept for the ids API surface")]
pub fn i64_to_i32(n: i64) -> AppResult<i32> {
    i32::try_from(n).map_err(|_| AppError::msg(format!("i64 out of i32 range: {n}")))
}

/// Settings / IPC `f64` down to the `f32` used by the audio engine.
#[allow(
    clippy::as_conversions,
    clippy::cast_possible_truncation,
    reason = "single narrowing point for audio gain/BPM values; f64->f32 has no From impl"
)]
#[must_use]
pub const fn f64_to_f32(v: f64) -> f32 {
    v as f32
}

/// Frame / sample index widened to `f64` for time maths.
#[allow(
    clippy::as_conversions,
    clippy::cast_precision_loss,
    reason = "single widening point; frame counts stay far below the f64 mantissa"
)]
#[must_use]
pub const fn usize_to_f64(n: usize) -> f64 {
    n as f64
}

/// Non-negative seconds/frames float clamped into a buffer index.
#[allow(
    clippy::as_conversions,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "saturating float->index conversion; negatives and NaN clamp to 0"
)]
#[must_use]
pub fn f64_to_usize(v: f64) -> usize {
    if v.is_nan() || v <= 0.0 {
        0
    } else {
        v as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_ids() {
        assert_eq!(id_to_i64(42), 42);
        assert_eq!(id_from_i64(42).expect("ok"), 42);
        assert!(id_from_i64(i64::from(i32::MAX) + 1).is_err());
    }
}
