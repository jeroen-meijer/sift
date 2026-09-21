import { useEffect, useRef } from "react";

export type PeakData = {
  channels: number;
  sample_rate: number;
  duration_ms: number;
  bucket_count: number;
  peaks: number[];
};

type Props = {
  peaks: PeakData | null;
  height?: number;
  playhead?: number | null;
  selection?: { start: number; end: number } | null;
  onSeek?: (secs: number) => void;
  onSelectRegion?: (start: number, end: number) => void;
  stereo?: boolean;
};

export function WaveformCanvas({
  peaks,
  height = 96,
  playhead = null,
  selection = null,
  onSeek,
  onSelectRegion,
  stereo = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ startX: number; startSecs: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const ch = Math.max(1, peaks.channels);
    const lanes = stereo && ch >= 2 ? 2 : 1;
    const laneH = height / lanes;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#9184d9";
    const muted = getComputedStyle(document.documentElement).getPropertyValue("--color-neutral-700").trim() || "#595d6c";

    for (let lane = 0; lane < lanes; lane++) {
      const mid = laneH * lane + laneH / 2;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (let i = 0; i < peaks.bucket_count; i++) {
        const base = i * ch * 2 + (lanes === 2 ? lane : 0) * 2;
        const min = peaks.peaks[base] ?? 0;
        const max = peaks.peaks[base + 1] ?? 0;
        const x = (i / peaks.bucket_count) * width;
        const y1 = mid - max * (laneH * 0.45);
        const y2 = mid - min * (laneH * 0.45);
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = muted;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(width, mid);
      ctx.stroke();
    }

    if (selection) {
      const dur = peaks.duration_ms / 1000;
      const x1 = (selection.start / dur) * width;
      const x2 = (selection.end / dur) * width;
      ctx.fillStyle = "rgba(145,132,217,0.18)";
      ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), height);
      ctx.strokeStyle = accent;
      ctx.strokeRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), height);
    }

    if (playhead != null) {
      const dur = peaks.duration_ms / 1000;
      const x = (playhead / dur) * width;
      ctx.strokeStyle = "#e9e9ed";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }, [peaks, height, playhead, selection, stereo]);

  const secsAt = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return 0;
    const rect = canvas.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return (t * peaks.duration_ms) / 1000;
  };

  return (
    <canvas
      ref={canvasRef}
      className="waveform-canvas"
      style={{ width: "100%", height }}
      onMouseDown={(e) => {
        const start = secsAt(e.clientX);
        dragRef.current = { startX: e.clientX, startSecs: start };
        onSeek?.(start);
      }}
      onMouseMove={(e) => {
        if (!dragRef.current || !onSelectRegion) return;
        if (Math.abs(e.clientX - dragRef.current.startX) < 3) return;
        onSelectRegion(dragRef.current.startSecs, secsAt(e.clientX));
      }}
      onMouseUp={(e) => {
        if (dragRef.current && onSelectRegion && Math.abs(e.clientX - dragRef.current.startX) >= 3) {
          onSelectRegion(dragRef.current.startSecs, secsAt(e.clientX));
        }
        dragRef.current = null;
      }}
    />
  );
}
