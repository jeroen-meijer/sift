import { memo, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { paintWaveLane, syncCanvasSize } from "../lib/drawWaveform";
import { usePlayheadStyle } from "../lib/liveStores";
import { cancelPaint, paintNow, schedulePaint } from "../lib/paintQueue";
import { isProfileOn, profileMark } from "../lib/profile";
import { getRowPeaks, subscribeRowPeaks } from "../lib/rowPeaks";
import { waveTheme } from "../lib/waveTheme";
import { subscribeThemePaint } from "../theme/subscribeThemePaint";

const HEIGHT = 18;

interface Props {
  sampleId: number;
  missing: boolean;
  /** When not `local`, no peaks are fetched (Online only / cloud stub). */
  availability: string;
  /** A worker is analyzing this sample right now. */
  analyzing: boolean;
  selected: boolean;
  /** Bass→red / mid→green / treble→blue from peak colors. */
  colored: boolean;
  /** This row is the one playing. */
  playing: boolean;
  /** Duration for the playhead, in ms. 0 when unknown. */
  durationMs: number;
  /** Canvas CSS width, measured once per resize by the table. */
  width: number;
  onScrub?: ((fraction: number) => void) | undefined;
}

/**
 * The compact row waveform: filled envelope tinted by spectral weights.
 *
 * Rows are recycled while scrolling, so the `<canvas>` stays mounted for every
 * state (placeholder line, missing, analyzing) and only its pixels change.
 * Creating a canvas cost ~240 ms per row in profiles; repainting costs ~0.
 */
export const RowWaveform = memo(function RowWaveform({
  sampleId,
  missing,
  availability,
  analyzing,
  selected,
  colored,
  playing,
  durationMs,
  width,
  onScrub,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playedRef = useRef<HTMLSpanElement>(null);
  const playheadRef = useRef<HTMLSpanElement>(null);
  /* Hover belongs to one sample; a recycled row must not inherit it. */
  const [hover, setHover] = useState<{ id: number; fraction: number } | null>(null);

  const local = !missing && availability === "local";
  const subscribe = useCallback((fn: () => void) => subscribeRowPeaks(sampleId, fn), [sampleId]);
  const getSnapshot = useCallback(() => (local ? getRowPeaks(sampleId) : undefined), [
    sampleId,
    local,
  ]);
  const peaks = useSyncExternalStore(subscribe, getSnapshot);

  const durationSecs = (durationMs > 0 ? durationMs : (peaks?.duration_ms ?? 0)) / 1000;
  usePlayheadStyle(playedRef, durationSecs, playing, "scale");
  usePlayheadStyle(playheadRef, durationSecs, playing, "translate");

  /* Layout effect: when a recycled row gets a new sample, its canvas is
   * repainted before the browser shows the frame, so it never shows the
   * previous sample's pixels. Never blank a wave that already belongs to
   * this sampleId (paint-budget used to clearRect and caused visible waves
   * to vanish then reappear). */
  const paintedIdRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const hasWave = peaks != null && peaks.bucket_count > 0;

    const paint = () => {
      const t0 = isProfileOn() ? performance.now() : 0;
      const dpr = window.devicePixelRatio || 1;
      const ctx = syncCanvasSize(canvas, width, HEIGHT, dpr);
      if (!ctx) return;
      ctx.clearRect(0, 0, width, HEIGHT);
      const theme = waveTheme();
      const ink = selected ? theme.inkSelected : theme.ink;

      if (!peaks || peaks.bucket_count === 0) {
        /* Placeholder: a faint line (dashed when the file is missing). */
        ctx.save();
        ctx.globalAlpha = missing ? 0.5 : 0.35;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        if (missing) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, HEIGHT / 2);
        ctx.lineTo(width, HEIGHT / 2);
        ctx.stroke();
        ctx.restore();
        paintedIdRef.current = null;
        return;
      }

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
          midY: HEIGHT / 2,
          ampScale: HEIGHT * 0.42,
          channelIndex: 0,
          colored,
          bands: theme.bands,
          ink,
          style: "gradient",
          maxColorStops: 32,
        },
      );
      paintedIdRef.current = sampleId;
      if (isProfileOn()) {
        profileMark(
          "fe.row_wave_paint",
          performance.now() - t0,
          `id=${String(sampleId)} buckets=${String(peaks.bucket_count)} colored=${String(colored)}`,
        );
      }
    };

    if (!paintNow(canvas, paint)) {
      if (paintedIdRef.current === sampleId && hasWave) {
        /* Same sample already on screen: finish later, do not clear. */
        schedulePaint(canvas, paint);
      } else {
        /* Wrong sample or empty: paint now so the row never flashes blank. */
        paint();
      }
    }
    const unsubscribe = subscribeThemePaint(paint);
    return () => {
      cancelPaint(canvas);
      unsubscribe();
    };
  }, [peaks, missing, selected, colored, sampleId, width]);

  const fractionAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const interactive = local && peaks != null;
  const hoverFraction = hover?.id === sampleId ? hover.fraction : null;

  return (
    <div
      className="row-wave"
      onMouseMove={
        interactive
          ? (e) => {
              setHover({ id: sampleId, fraction: fractionAt(e) });
            }
          : undefined
      }
      onMouseLeave={() => {
        setHover(null);
      }}
      onClick={(e) => {
        if (!onScrub || !interactive) return;
        e.stopPropagation();
        onScrub(fractionAt(e));
      }}
    >
      <canvas ref={canvasRef} className="row-wave-canvas" style={{ width }} />
      {analyzing ? (
        <span className="row-wave-analyzing" aria-hidden>
          <span className="row-wave-shimmer" />
        </span>
      ) : null}
      {playing ? (
        <>
          <span ref={playedRef} className="row-wave-played" />
          <span ref={playheadRef} className="row-wave-playhead-track">
            <span className="row-wave-playhead" />
          </span>
        </>
      ) : null}
      {hoverFraction != null ? (
        <span className="row-wave-cursor" style={{ left: `${(hoverFraction * 100).toFixed(2)}%` }} />
      ) : null}
    </div>
  );
});
