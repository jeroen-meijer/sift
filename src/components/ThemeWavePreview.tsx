import { useEffect, useRef } from "react";
import { paintWaveLane, syncCanvasSize } from "../lib/drawWaveform";
import { parseCssColor, type SpectralBandColors } from "../lib/spectralColor";
import { THEME_INFO, type ThemeId } from "../theme/index";

const PREVIEW_BUCKETS = 72;

/** Shared demo strip: bass punch → mid body → treble tail. */
function previewLane(): {
  peaks: number[];
  colors: number[];
  bucketCount: number;
  channels: number;
} {
  const peaks: number[] = [];
  const colors: number[] = [];
  const last = PREVIEW_BUCKETS - 1;
  for (let i = 0; i < PREVIEW_BUCKETS; i++) {
    const t = i / last;
    const envelope =
      Math.pow(Math.sin(Math.PI * t), 0.55) *
      (0.42 + 0.58 * Math.abs(Math.sin(Math.PI * t * 3.2)));
    const amp = Math.min(1, envelope);
    peaks.push(-amp, amp);
    const bass = Math.max(0, 1 - t * 1.55);
    const mid = Math.max(0, 1 - Math.abs(t - 0.42) * 2.4);
    const treble = Math.max(0, (t - 0.38) * 1.65);
    const sum = bass + mid + treble || 1;
    colors.push(
      Math.round((bass / sum) * 255),
      Math.round((mid / sum) * 255),
      Math.round((treble / sum) * 255),
    );
  }
  return { peaks, colors, bucketCount: PREVIEW_BUCKETS, channels: 1 };
}

const PREVIEW = previewLane();

function bandsForTheme(id: ThemeId): SpectralBandColors {
  const hex = THEME_INFO[id].waveBands;
  const fallback: SpectralBandColors = {
    bass: [255, 61, 138],
    mid: [46, 232, 154],
    treble: [78, 184, 255],
  };
  return {
    bass: parseCssColor(hex.bass) ?? fallback.bass,
    mid: parseCssColor(hex.mid) ?? fallback.mid,
    treble: parseCssColor(hex.treble) ?? fallback.treble,
  };
}

interface Props {
  themeId: ThemeId;
}

/** Compact spectral strip for a theme picker card. */
export function ThemeWavePreview({ themeId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 160;
      const height = canvas.clientHeight || 28;
      const ctx = syncCanvasSize(canvas, width, height, dpr);
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      paintWaveLane(ctx, PREVIEW, {
        width,
        midY: height / 2,
        ampScale: height * 0.42,
        channelIndex: 0,
        colored: true,
        bands: bandsForTheme(themeId),
        ink: "#888",
        maxColorStops: 36,
      });
    };

    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [themeId]);

  return <canvas ref={canvasRef} className="theme-wave-preview" aria-hidden />;
}
