import { useEffect, useRef, useState } from "react";
import { paintWaveLane, syncCanvasSize } from "../lib/drawWaveform";
import { cachedRowPeaks, loadRowPeaks } from "../lib/rowPeaks";
import { readSpectralBands } from "../lib/spectralColor";
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

/** The compact row waveform: filled envelope tinted by spectral weights. */
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
      const ctx = syncCanvasSize(canvas, width, height, dpr);
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      const styles = getComputedStyle(canvas);
      const ink =
        styles
          .getPropertyValue(selected ? "--color-row-wave-sel" : "--color-row-wave")
          .trim() || "#6a6d80";
      const bands = readSpectralBands(canvas);
      paintWaveLane(
        ctx,
        {
          peaks: peaks.peaks,
          colors: peaks.colors,
          bucketCount: peaks.bucket_count,
          channels: Math.max(1, peaks.channels),
        },
        {
          width,
          midY: height / 2,
          ampScale: height * 0.42,
          channelIndex: 0,
          colored,
          bands,
          ink,
          maxColorStops: 32,
        },
      );
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
