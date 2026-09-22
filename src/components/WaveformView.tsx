import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatSpan, formatTime } from "../lib/format";
import type { PeakData, SnapMode, WaveformView as WaveformMode } from "../lib/ipc";

export interface Selection {
  start: number;
  end: number;
}

interface Props {
  peaks: PeakData | null;
  bpm: number | null;
  snap: SnapMode;
  mode: WaveformMode;
  playheadSecs: number | null;
  selection: Selection | null;
  clipReady: boolean;
  onSeek: (secs: number) => void;
  onSelect: (selection: Selection | null) => void;
  onDragClip: () => void;
}

const MIN_DRAG_PX = 3;
const RULER_TARGET_MARKS = 5;

function snapDivisor(snap: SnapMode): number | null {
  switch (snap) {
    case "1/4":
      return 1;
    case "1/8":
      return 2;
    case "1/16":
      return 4;
    default:
      return null;
  }
}

function rulerStep(duration: number): number {
  const raw = duration / RULER_TARGET_MARKS;
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  return steps.find((s) => s >= raw) ?? 120;
}

export function WaveformView({
  peaks,
  bpm,
  snap,
  mode,
  playheadSecs,
  selection,
  clipReady,
  onSeek,
  onSelect,
  onDragClip,
}: Props) {
  const { t } = useTranslation("library");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startSecs: number; edge: "start" | "end" | null } | null>(
    null,
  );
  const [size, setSize] = useState({ width: 0, height: 0 });

  const duration = peaks ? peaks.duration_ms / 1000 : 0;
  const lanes = mode === "stereo" && (peaks?.channels ?? 0) >= 2 ? 2 : 1;

  /* Keep the canvas matched to its box. */
  useEffect(() => {
    const well = wellRef.current;
    if (!well) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(well);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || size.width === 0 || size.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    const ink = styles.getPropertyValue("--color-wave-ink").trim();
    const laneHeight = height / lanes;
    const channels = Math.max(1, peaks.channels);

    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    for (let lane = 0; lane < lanes; lane++) {
      const mid = laneHeight * lane + laneHeight / 2;
      ctx.beginPath();
      for (let i = 0; i < peaks.bucket_count; i++) {
        const base = i * channels * 2 + (lanes === 2 ? lane * 2 : 0);
        const min = peaks.peaks[base] ?? 0;
        const max = peaks.peaks[base + 1] ?? 0;
        const x = (i / peaks.bucket_count) * width;
        ctx.moveTo(x, mid - max * laneHeight * 0.46);
        ctx.lineTo(x, mid - min * laneHeight * 0.46);
      }
      ctx.stroke();
    }

    if (lanes === 2) {
      ctx.strokeStyle = "rgba(233,233,237,0.09)";
      ctx.beginPath();
      ctx.moveTo(0, laneHeight);
      ctx.lineTo(width, laneHeight);
      ctx.stroke();
    }
  }, [peaks, size, lanes]);

  const gridStyle = useMemo(() => {
    const divisor = snapDivisor(snap);
    if (divisor == null || bpm == null || bpm <= 0 || duration <= 0) return undefined;
    const beat = 60 / bpm;
    const stepPct = ((beat / divisor) / duration) * 100;
    if (stepPct < 0.4) return undefined;
    const barPct = ((beat * 4) / duration) * 100;
    const layers = [
      `repeating-linear-gradient(90deg, rgba(233,233,237,.09) 0 1px, transparent 1px ${stepPct.toFixed(4)}%)`,
    ];
    if (barPct <= 100) {
      layers.unshift(
        `repeating-linear-gradient(90deg, rgba(145,132,217,.30) 0 1px, transparent 1px ${barPct.toFixed(4)}%)`,
      );
    }
    return { background: layers.join(", ") };
  }, [snap, bpm, duration]);

  const rulerMarks = useMemo(() => {
    if (duration <= 0) return [];
    const step = rulerStep(duration);
    const marks: number[] = [];
    for (let t = 0; t < duration - step * 0.25; t += step) marks.push(t);
    return marks;
  }, [duration]);

  const secsAt = useCallback(
    (clientX: number) => {
      const well = wellRef.current;
      if (!well || duration <= 0) return 0;
      const rect = well.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return fraction * duration;
    },
    [duration],
  );

  const pct = (secs: number) => (duration > 0 ? (secs / duration) * 100 : 0);

  const onPointerDown = (e: React.PointerEvent, edge: "start" | "end" | null) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const secs = secsAt(e.clientX);
    dragRef.current = { startX: e.clientX, startSecs: secs, edge };
    if (edge == null) onSeek(secs);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const secs = secsAt(e.clientX);
    if (drag.edge === "start" && selection) {
      onSelect({ start: Math.min(secs, selection.end), end: selection.end });
      return;
    }
    if (drag.edge === "end" && selection) {
      onSelect({ start: selection.start, end: Math.max(secs, selection.start) });
      return;
    }
    if (Math.abs(e.clientX - drag.startX) < MIN_DRAG_PX) return;
    onSelect({ start: Math.min(drag.startSecs, secs), end: Math.max(drag.startSecs, secs) });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  };

  /* The pill only offers the drag once the clip behind it exists. */
  const spanLabel = selection
    ? (() => {
        const secs = (selection.end - selection.start).toFixed(2);
        const span = formatSpan(selection.start, selection.end, bpm);
        if (span) return t(clipReady ? "clipHint" : "clipPending", { span, secs });
        return t(clipReady ? "clipHintNoBpm" : "clipPendingNoBpm", { secs });
      })()
    : null;

  return (
    <div
      ref={wellRef}
      className="wave-well"
      onPointerDown={(e) => {
        onPointerDown(e, null);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {gridStyle ? <div className="wave-grid" style={gridStyle} aria-hidden /> : null}

      <canvas ref={canvasRef} className="wave-canvas" aria-label={t("waveform")} />

      <div className="wave-ruler" aria-hidden>
        {rulerMarks.map((mark) => (
          <span key={mark} className="wave-ruler-mark" style={{ left: `${pct(mark)}%` }}>
            {formatTime(mark)}
          </span>
        ))}
      </div>

      <span className="wave-lane-label" style={{ top: 5 }} aria-hidden>
        {lanes === 2 ? "L" : "M"}
      </span>
      {lanes === 2 ? (
        <span className="wave-lane-label" style={{ top: "calc(50% + 5px)" }} aria-hidden>
          R
        </span>
      ) : null}

      {selection ? (
        <>
          <div className="wave-dim" style={{ left: 0, width: `${pct(selection.start)}%` }} />
          <div
            className="wave-dim"
            style={{ right: 0, width: `${100 - pct(selection.end)}%` }}
          />
          <div
            className={`wave-selection${clipReady ? " draggable" : ""}`}
            draggable={clipReady}
            style={{
              left: `${pct(selection.start)}%`,
              width: `${pct(selection.end) - pct(selection.start)}%`,
            }}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "copy";
              onDragClip();
            }}
          />
          <div
            className="wave-handle"
            role="slider"
            tabIndex={0}
            aria-label={t("selectionStart")}
            aria-valuenow={selection.start}
            aria-valuemin={0}
            aria-valuemax={duration}
            style={{ left: `${pct(selection.start)}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e, "start");
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
          >
            <span />
          </div>
          <div
            className="wave-handle"
            role="slider"
            tabIndex={0}
            aria-label={t("selectionEnd")}
            aria-valuenow={selection.end}
            aria-valuemin={0}
            aria-valuemax={duration}
            style={{ left: `${pct(selection.end)}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e, "end");
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
          >
            <span />
          </div>
          {spanLabel ? (
            <div className="wave-clip-pill" style={{ left: `${pct(selection.start)}%` }}>
              {spanLabel}
            </div>
          ) : null}
        </>
      ) : null}

      {playheadSecs != null && duration > 0 ? (
        <>
          <div className="wave-playhead" style={{ left: `${pct(playheadSecs)}%` }} />
          <div className="wave-playhead-cap" style={{ left: `${pct(playheadSecs)}%` }} />
        </>
      ) : null}
    </div>
  );
}
