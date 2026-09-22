interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  width?: number | string;
  label: string;
  onChange: (next: number) => void;
}

/**
 * The 3px track with an 11px knob. A native range input underneath keeps
 * arrow keys and screen readers working; CSS does the rest.
 */
export function Slider({ value, min, max, step = 1, width = 96, label, onChange }: Props) {
  const span = max - min;
  const fraction = span > 0 ? (value - min) / span : 0;
  return (
    <input
      type="range"
      className="slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ width, ["--slider-fill" as string]: `${(fraction * 100).toFixed(2)}%` }}
      onChange={(e) => {
        onChange(Number(e.target.value));
      }}
    />
  );
}
