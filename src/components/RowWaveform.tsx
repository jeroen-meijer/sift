import { useEffect, useRef, useState } from "react";
import { ipc, type PeakData } from "../lib/ipc";

/** Peaks are immutable per sample, so one cache serves every row that scrolls by. */
const peakCache = new Map<number, PeakData>();
const inFlight = new Map<number, Promise<PeakData | null>>();

function loadPeaks(sampleId: number): Promise<PeakData | null> {
  const cached = peakCache.get(sampleId);
  if (cached) return Promise.resolve(cached);
  const existing = inFlight.get(sampleId);
  if (existing) return existing;
  const request = ipc
    .getPeaks(sampleId)
    .then((data) => {
      peakCache.set(sampleId, data);
      return data;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(sampleId));
  inFlight.set(sampleId, request);
  return request;
}

interface Props {
  sampleId: number;
  missing: boolean;
  analyzing: boolean;
  selected: boolean;
  /** Fraction 0–1 of the playhead, or null when this row is not playing. */
  progress: number | null;
  onScrub?: ((fraction: number) => void) | undefined;
}

/** The compact row waveform: one vertical tick per peak bucket. */
export function RowWaveform({
  sampleId,
  missing,
  analyzing,
  selected,
  progress,
  onScrub,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<PeakData | null>(() => peakCache.get(sampleId) ?? null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const idle = missing || analyzing;

  useEffect(() => {
    if (idle) return;
    let alive = true;
    void loadPeaks(sampleId).then((data) => {
      if (alive) setPeaks(data);
    });
    return () => {
      alive = false;
    };
  }, [sampleId, idle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || idle) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 120;
    const height = 18;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    ctx.strokeStyle = styles
      .getPropertyValue(selected ? "--color-row-wave-sel" : "--color-row-wave")
      .trim();
    ctx.lineWidth = 1.05;
    const mid = height / 2;
    const channels = Math.max(1, peaks.channels);
    const last = Math.max(1, peaks.bucket_count - 1);
    ctx.beginPath();
    for (let i = 0; i < peaks.bucket_count; i++) {
      const base = i * channels * 2;
      const amp = Math.max(
        Math.abs(peaks.peaks[base] ?? 0),
        Math.abs(peaks.peaks[base + 1] ?? 0),
      );
      const x = (i / last) * width;
      const y = amp * (height * 0.42);
      ctx.moveTo(x, mid - y);
      ctx.lineTo(x, mid + y);
    }
    ctx.stroke();
  }, [peaks, idle, selected]);

  if (analyzing) {
    return (
      <div className="row-wave row-wave-analyzing" aria-hidden>
        <span className="row-wave-shimmer" />
      </div>
    );
  }
  if (missing) {
    return <div className="row-wave row-wave-missing" aria-hidden />;
  }

  const fractionAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  return (
    <div
      className="row-wave"
      onMouseMove={(e) => {
        setHoverFraction(fractionAt(e));
      }}
      onMouseLeave={() => {
        setHoverFraction(null);
      }}
      onClick={(e) => {
        if (!onScrub) return;
        e.stopPropagation();
        onScrub(fractionAt(e));
      }}
    >
      <canvas ref={canvasRef} className="row-wave-canvas" />
      {progress != null ? (
        <>
          <span className="row-wave-played" style={{ width: `${(progress * 100).toFixed(2)}%` }} />
          <span className="row-wave-playhead" style={{ left: `${(progress * 100).toFixed(2)}%` }} />
        </>
      ) : null}
      {hoverFraction != null ? (
        <span
          className="row-wave-cursor"
          style={{ left: `${(hoverFraction * 100).toFixed(2)}%` }}
        />
      ) : null}
    </div>
  );
}
