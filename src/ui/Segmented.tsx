import { useLayoutEffect, useRef, useState } from "react";

interface Props<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}

interface Thumb {
  left: number;
  width: number;
}

/** Segmented control with a sliding thumb behind the active option. */
export function Segmented<T extends string>({ value, options, onChange, label }: Props<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    setThumb({ left: active.offsetLeft, width: active.offsetWidth });
    /* Skip the slide on the first paint so mount does not animate from 0. */
    const frame = requestAnimationFrame(() => {
      setReady(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [value, options]);

  return (
    <div ref={rootRef} className="seg" role="radiogroup" aria-label={label}>
      {thumb ? (
        <span
          className={`seg-thumb${ready ? " ready" : ""}`}
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
          aria-hidden
        />
      ) : null}
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active ? "true" : undefined}
            className={`seg-opt${active ? " on" : ""}`}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
