import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { PeakData } from "./WaveformCanvas";

const cache = new Map<number, PeakData>();

interface Props {
  sampleId: number;
  missing: boolean;
  analyzing: boolean;
  showWaveform: boolean;
}

/** Compact row waveform matching the Claude Design SVG ink stroke. */
export function RowWaveform({ sampleId, missing, analyzing, showWaveform }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<PeakData | null>(() => cache.get(sampleId) ?? null);

  useEffect(() => {
    if (!showWaveform || missing || analyzing) {
      return;
    }
    const cached = cache.get(sampleId);
    if (cached) {
      setPeaks(cached);
      return;
    }
    let cancelled = false;
    void invoke<PeakData>("get_peaks", { sampleId })
      .then((data) => {
        cache.set(sampleId, data);
        if (!cancelled) setPeaks(data);
      })
      .catch(() => {
        if (!cancelled) setPeaks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sampleId, showWaveform, missing, analyzing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !showWaveform || analyzing || missing) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 120;
    const height = 18;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const ink =
      getComputedStyle(document.documentElement).getPropertyValue("--color-neutral-500").trim() ||
      "#75798c";
    const mid = height / 2;
    const ch = Math.max(1, peaks.channels);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    for (let i = 0; i < peaks.bucket_count; i++) {
      const base = i * ch * 2;
      const min = peaks.peaks[base] ?? 0;
      const max = peaks.peaks[base + 1] ?? 0;
      const amp = Math.max(Math.abs(min), Math.abs(max));
      const x = (i / Math.max(1, peaks.bucket_count - 1)) * width;
      const y = amp * (height * 0.42);
      ctx.moveTo(x, mid - y);
      ctx.lineTo(x, mid + y);
    }
    ctx.stroke();
  }, [peaks, showWaveform, analyzing, missing]);

  if (analyzing) {
    return (
      <div className="row-wave row-wave-analyzing" aria-hidden>
        <div className="row-wave-shimmer" />
      </div>
    );
  }
  if (missing) {
    return <div className="row-wave row-wave-missing" aria-hidden />;
  }
  if (!showWaveform) {
    return <div className="row-wave row-wave-off" aria-hidden />;
  }
  return (
    <div className="row-wave">
      <canvas ref={canvasRef} className="row-wave-canvas" />
    </div>
  );
}
