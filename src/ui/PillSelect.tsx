import { CaretDownIcon } from "@phosphor-icons/react";

interface Props<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
  variant?: "pill" | "input";
  width?: number;
}

/**
 * A native select wearing the design's `#232532` pill (transport snap) or its
 * `.input` box (settings output device). Native keeps the platform menu.
 */
export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  variant = "pill",
  width,
}: Props<T>) {
  return (
    <span className={`pill-select pill-select-${variant}`} style={width ? { width } : undefined}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => {
          onChange(e.target.value as T);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <CaretDownIcon size={9} weight="bold" aria-hidden />
    </span>
  );
}
