import { useEffect, useRef } from "react";
import { paintWaveLane, syncCanvasSize } from "../lib/drawWaveform";
import { parseCssColor, type SpectralBandColors } from "../lib/spectralColor";
import { buildThemePreviewLane } from "../lib/themeWavePreviewData";
import { THEME_INFO, type ThemeId } from "../theme/index";

const PREVIEW = buildThemePreviewLane();

function bandsForTheme(id: ThemeId): SpectralBandColors {
  const hex = THEME_INFO[id].waveBands;
  const fallback: SpectralBandColors = {
    bass: [255, 61, 138],
    lowMid: [46, 232, 154],
    highMid: [64, 200, 232],
    treble: [139, 124, 255],
  };
  return {
    bass: parseCssColor(hex.bass) ?? fallback.bass,
    lowMid: parseCssColor(hex.lowMid) ?? fallback.lowMid,
    highMid: parseCssColor(hex.highMid) ?? fallback.highMid,
    treble: parseCssColor(hex.treble) ?? fallback.treble,
  };
}

interface Props {
  themeId: ThemeId;
}

/** Compact spectral strip for a theme picker card (same paint path as detail). */
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
        style: "gradient",
        maxColorStops: 48,
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
