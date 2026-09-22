interface Props {
  min: number;
  max: number;
  low: number;
  high: number;
  lowLabel: string;
  highLabel: string;
  onChange: (low: number, high: number) => void;
}

/**
 * Two-thumb range. Two stacked native inputs: the track is drawn once, and
 * whichever thumb the pointer is nearer takes the drag.
 */
export function RangeSlider({ min, max, low, high, lowLabel, highLabel, onChange }: Props) {
  const span = max - min || 1;
  const leftPct = ((low - min) / span) * 100;
  const rightPct = ((high - min) / span) * 100;

  return (
    <div className="range-slider">
      <div className="range-slider-track">
        <div
          className="range-slider-fill"
          style={{ left: `${leftPct.toFixed(2)}%`, right: `${(100 - rightPct).toFixed(2)}%` }}
        />
      </div>
      <input
        type="range"
        className="range-slider-input"
        aria-label={lowLabel}
        min={min}
        max={max}
        value={low}
        onChange={(e) => {
          onChange(Math.min(Number(e.target.value), high), high);
        }}
      />
      <input
        type="range"
        className="range-slider-input"
        aria-label={highLabel}
        min={min}
        max={max}
        value={high}
        onChange={(e) => {
          onChange(low, Math.max(Number(e.target.value), low));
        }}
      />
    </div>
  );
}
