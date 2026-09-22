import { useEffect, useRef } from "react";
import {
  blendSpectralRgb,
  parseCssColor,
  type Rgb,
  type SpectralBandColors,
} from "../lib/spectralColor";
import { THEME_INFO, type ThemeId } from "../theme/index";

const PREVIEW_BUCKETS = 72;

/** Shared demo strip: bass punch → mid body → treble tail. */
function previewSamples(): { amp: number; weights: Rgb }[] {
  const out: { amp: number; weights: Rgb }[] = [];
  const last = PREVIEW_BUCKETS - 1;
  for (let i = 0; i < PREVIEW_BUCKETS; i++) {
    const t = i / last;
    const envelope =
      Math.pow(Math.sin(Math.PI * t), 0.55) *
      (0.42 + 0.58 * Math.abs(Math.sin(Math.PI * t * 3.2)));
    const bass = Math.max(0, 1 - t * 1.55);
    const mid = Math.max(0, 1 - Math.abs(t - 0.42) * 2.4);
    const treble = Math.max(0, (t - 0.38) * 1.65);
    const sum = bass + mid + treble || 1;
    out.push({
      amp: Math.min(1, envelope),
      weights: [
        Math.round((bass / sum) * 255),
        Math.round((mid / sum) * 255),
        Math.round((treble / sum) * 255),
      ],
    });
  }
  return out;
}

const SAMPLES = previewSamples();

function bandsForTheme(id: ThemeId): SpectralBandColors {
  const hex = THEME_INFO[id].waveBands;
  const fallback: SpectralBandColors = {
    bass: [240, 96, 140],
    mid: [110, 210, 150],
    treble: [130, 180, 255],
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
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const bands = bandsForTheme(themeId);
      const mid = height / 2;
      const last = SAMPLES.length - 1;
      ctx.lineWidth = 1.1;
      for (let i = 0; i < SAMPLES.length; i++) {
        const sample = SAMPLES[i];
        if (!sample) continue;
        const [r, g, b] = blendSpectralRgb(sample.weights, bands);
        ctx.strokeStyle = `rgb(${String(r)},${String(g)},${String(b)})`;
        const x = (i / last) * width;
        const y = sample.amp * height * 0.42;
        ctx.beginPath();
        ctx.moveTo(x, mid - y);
        ctx.lineTo(x, mid + y);
        ctx.stroke();
      }
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
