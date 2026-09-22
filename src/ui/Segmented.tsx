import { useId } from "react";

interface Props<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}

/** Nocturne `.seg` — a radio group that reads as one control. */
export function Segmented<T extends string>({ value, options, onChange, label }: Props<T>) {
  const name = useId();
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className="seg-opt">
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => {
              onChange(option.value);
            }}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
