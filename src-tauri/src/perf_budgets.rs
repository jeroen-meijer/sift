//! Soft wall-clock budgets for hot paths (debug-friendly CI guards).
//!
//! These catch catastrophic regressions, not micro-optimizations.
//! For timings and comparisons, run Criterion:
//! `cargo bench --bench audio_hotpath`
//!
//! Print timings locally:
//! `cargo nextest run -E 'test(/^perf_/)' --no-capture`

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    use crate::perf::{
        AnalysisInput, Analyzer, DEFAULT_BUCKETS, HeuristicAnalyzer, PathTokenAnalyzer,
        decode_file, generate_peaks, render_clip, to_mono,
    };

    fn examples_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../example_samples")
    }

    fn fixture(rel: &str) -> Option<PathBuf> {
        let path = examples_root().join(rel);
        path.exists().then_some(path)
    }

    fn measure<R>(label: &str, budget: Duration, f: impl FnOnce() -> R) -> R {
        let start = Instant::now();
        let out = f();
        let elapsed = start.elapsed();
        eprintln!("perf {label}: {elapsed:?} (budget {budget:?})");
        assert!(
            elapsed <= budget,
            "{label} took {elapsed:?}, over soft budget {budget:?}"
        );
        out
    }

    #[test]
    fn perf_decode_short_wav() {
        let Some(path) = fixture("amen_breaks/cw_amen_chopper.wav") else {
            eprintln!("skip: missing amen chopper fixture");
            return;
        };
        // Debug builds on CI; keep generous.
        let decoded = measure("decode_short_wav", Duration::from_secs(2), || {
            decode_file(&path).expect("decode")
        });
        assert!(decoded.frame_count() > 0);
    }

    #[test]
    fn perf_decode_medium_wav() {
        let Some(path) = fixture("heatwave/Moods/mood-hopeful.wav") else {
            eprintln!("skip: missing mood-hopeful fixture");
            return;
        };
        let decoded = measure("decode_medium_wav", Duration::from_secs(4), || {
            decode_file(&path).expect("decode")
        });
        assert!(decoded.duration_ms() > 0.0);
    }

    #[test]
    fn perf_decode_mp3() {
        let Some(path) = fixture("amen_breaks/cw_amen_distorted.mp3") else {
            eprintln!("skip: missing mp3 fixture");
            return;
        };
        let decoded = measure("decode_mp3", Duration::from_secs(3), || {
            decode_file(&path).expect("decode")
        });
        assert!(decoded.sample_rate > 0);
    }

    #[test]
    fn perf_generate_peaks_default_buckets() {
        let Some(path) = fixture("heatwave/Moods/mood-hopeful.wav") else {
            eprintln!("skip: missing mood-hopeful fixture");
            return;
        };
        let decoded = decode_file(&path).expect("decode");
        let peaks = measure("generate_peaks_1024", Duration::from_secs(3), || {
            generate_peaks(&decoded, DEFAULT_BUCKETS).expect("peaks")
        });
        assert_eq!(peaks.bucket_count, DEFAULT_BUCKETS);
    }

    #[test]
    fn perf_jit_render_clip() {
        let Some(path) = fixture("heatwave/Moods/mood-hopeful.wav") else {
            eprintln!("skip: missing mood-hopeful fixture");
            return;
        };
        let out = std::env::temp_dir().join("sift_perf_jit_clip.wav");
        measure("jit_render_0.2s", Duration::from_secs(5), || {
            render_clip(&path, 0.1, 0.3, &out).expect("render");
        });
        assert!(out.exists());
        let _ = std::fs::remove_file(&out);
    }

    #[test]
    fn perf_path_token_analyze() {
        let mono = vec![0.0f32; 256];
        let input = AnalysisInput::from_full_mono(&mono, 44_100);
        let path = Path::new("/library/Drums/Kick/Kick_Hard_01.wav");
        let result = measure("path_token_analyze", Duration::from_millis(50), || {
            PathTokenAnalyzer.analyze(path, &input, 70.0, 180.0)
        });
        assert!(result.suggested_tag_paths.iter().any(|t| t == "Drums/Kick"));
    }

    #[test]
    fn perf_heuristic_analyze_short_loop() {
        let Some(path) = fixture("amen_breaks/cw_amen_chopper.wav") else {
            eprintln!("skip: missing amen chopper fixture");
            return;
        };
        let decoded = decode_file(&path).expect("decode");
        let mono = to_mono(&decoded);
        let input = AnalysisInput::from_full_mono(&mono, decoded.sample_rate);
        // stratum-dsp is the heavy part; budget is for debug CI, not release.
        let result = measure("heuristic_analyze", Duration::from_secs(8), || {
            HeuristicAnalyzer.analyze(&path, &input, 70.0, 180.0)
        });
        assert!(result.sample_type.is_some());
    }
}
