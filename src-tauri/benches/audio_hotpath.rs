//! Criterion benches for Sift audio / analysis hot paths.
//!
//! Run from `src-tauri/`:
//! ```text
//! cargo bench --bench audio_hotpath
//! cargo bench --bench audio_hotpath -- --warm-up-time 1 --measurement-time 3
//! ```
//!
//! Primary fixture: `../testdata/spectral-fixtures/band-probe.wav`.

#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "bench harness: fail fast on fixture/setup errors"
)]

use std::hint::black_box;
use std::path::{Path, PathBuf};
use std::time::Duration;

use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use sift_lib::perf::{
    AnalysisInput, Analyzer, DEFAULT_BUCKETS, HeuristicAnalyzer, PathTokenAnalyzer, decode_file,
    generate_peaks, render_clip, to_mono,
};
use tempfile::tempdir;

fn band_probe() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../testdata/spectral-fixtures/band-probe.wav")
}

fn require_fixture() -> PathBuf {
    let path = band_probe();
    assert!(
        path.exists(),
        "missing bench fixture {} (expected under testdata/spectral-fixtures/)",
        path.display()
    );
    path
}

fn decode_benches(c: &mut Criterion) {
    let mut group = c.benchmark_group("decode");
    group.warm_up_time(Duration::from_secs(1));
    group.measurement_time(Duration::from_secs(3));
    group.sample_size(20);

    let path = require_fixture();
    group.bench_with_input(
        BenchmarkId::from_parameter("wav_band_probe"),
        &path,
        |b, path| {
            b.iter(|| {
                let decoded = decode_file(black_box(path)).expect("decode");
                black_box(decoded.samples.len())
            });
        },
    );

    group.finish();
}

fn peaks_benches(c: &mut Criterion) {
    let path = require_fixture();
    let decoded = decode_file(&path).expect("decode for peaks bench");

    let mut group = c.benchmark_group("peaks");
    group.warm_up_time(Duration::from_secs(1));
    group.measurement_time(Duration::from_secs(3));
    group.sample_size(30);

    for buckets in [256usize, DEFAULT_BUCKETS, 4096] {
        group.bench_with_input(BenchmarkId::from_parameter(buckets), &buckets, |b, &n| {
            b.iter(|| {
                let peaks = generate_peaks(black_box(&decoded), black_box(n)).expect("peaks");
                black_box(peaks.bucket_count)
            });
        });
    }

    group.finish();
}

fn jit_benches(c: &mut Criterion) {
    let path = require_fixture();
    let dir = tempdir().expect("tempdir");
    let out = dir.path().join("clip.wav");

    let mut group = c.benchmark_group("jit_render");
    group.warm_up_time(Duration::from_secs(1));
    group.measurement_time(Duration::from_secs(3));
    group.sample_size(20);

    group.bench_function("clip_0.2s", |b| {
        b.iter(|| {
            render_clip(black_box(&path), 0.1, 0.3, black_box(&out)).expect("render");
            black_box(out.metadata().map_or(0, |m| m.len()));
        });
    });

    group.finish();
}

fn analyze_benches(c: &mut Criterion) {
    let path = require_fixture();
    let decoded = decode_file(&path).expect("decode for analyze bench");
    let mono = to_mono(&decoded);
    let input = AnalysisInput::from_full_mono(&mono, decoded.sample_rate);

    let mut group = c.benchmark_group("analyze");
    group.warm_up_time(Duration::from_secs(1));
    group.measurement_time(Duration::from_secs(5));
    group.sample_size(15);

    group.bench_function("path_tokens", |b| {
        let p = Path::new("/packs/Drums/Kick_Hard_loop_120.wav");
        b.iter(|| {
            let r = PathTokenAnalyzer.analyze(black_box(p), black_box(&input), 70.0, 180.0);
            black_box(r.suggested_tag_paths.len())
        });
    });

    group.bench_function("heuristic_bpm_key", |b| {
        b.iter(|| {
            let r = HeuristicAnalyzer.analyze(black_box(&path), black_box(&input), 70.0, 180.0);
            black_box((r.bpm, r.key_name, r.sample_type))
        });
    });

    group.finish();
}

criterion_group!(
    benches,
    decode_benches,
    peaks_benches,
    jit_benches,
    analyze_benches
);
criterion_main!(benches);
