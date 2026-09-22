import { useEffect, useRef, useState } from "react";
import { cachedRowPeaks, loadRowPeaks } from "../lib/rowPeaks";
import { bucketWeights, readSpectralBands, spectralCss } from "../lib/spectralColor";
import { subscribeThemePaint } from "../theme/subscribeThemePaint";

interface Props {
  sampleId: number;
  missing: boolean;
  analyzing: boolean;
  selected: boolean;
  /** Bass→red / mid→green / treble→blue from peak colors. */
  colored: boolean;
  /** Fraction 0-1 of the playhead, or null when this row is not playing. */
  progress: number | null;
  onScrub?: ((fraction: number) => void) | undefined;
}

/** The compact row waveform: one vertical tick per peak bucket. */
export function RowWaveform({
  sampleId,
  missing,
  analyzing,
  selected,
  colored,
  progress,
  onScrub,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState(() => cachedRowPeaks(sampleId));
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const idle = missing || analyzing;

  useEffect(() => {
    if (idle) {
      setPeaks(null);
      return;
    }
    /* Virtual rows reuse this component; sync from cache before any fetch. */
    const cached = cachedRowPeaks(sampleId);
    setPeaks(cached);
    if (cached) return;
    let alive = true;
    void loadRowPeaks(sampleId).then((data) => {
      if (alive) setPeaks(data);
    });
    return () => {
      alive = false;
    };
  }, [sampleId, idle]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || idle) return;

    const paint = () => {
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
      const ink = styles
        .getPropertyValue(selected ? "--color-row-wave-sel" : "--color-row-wave")
        .trim();
      const bands = readSpectralBands(canvas);
      ctx.lineWidth = 1.05;
      const mid = height / 2;
      const channels = Math.max(1, peaks.channels);
      const last = Math.max(1, peaks.bucket_count - 1);
      const hasColors = colored && peaks.colors.length >= peaks.bucket_count * 3;

      for (let i = 0; i < peaks.bucket_count; i++) {
        const base = i * channels * 2;
        const amp = Math.max(
          Math.abs(peaks.peaks[base] ?? 0),
          Math.abs(peaks.peaks[base + 1] ?? 0),
        );
        const x = (i / last) * width;
        const y = amp * (height * 0.42);
        ctx.strokeStyle = hasColors
          ? spectralCss(bucketWeights(peaks.colors, i), bands)
          : ink;
        ctx.beginPath();
        ctx.moveTo(x, mid - y);
        ctx.lineTo(x, mid + y);
        ctx.stroke();
      }
    };

    paint();
    return subscribeThemePaint(paint);
  }, [peaks, idle, selected, colored]);

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
