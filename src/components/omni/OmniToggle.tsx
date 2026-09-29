interface Props {
  on: boolean;
  label: string;
  onToggle: () => void;
}

/** Half/double and relative switch used on chips and in editor headers. */
export function OmniToggle({ on, label, onToggle }: Props) {
  return (
    <button
      type="button"
      className={`omni-toggle${on ? " on" : ""}`}
      aria-pressed={on}
      onClick={onToggle}
    >
      <span className="omni-toggle-track">
        <span className="omni-toggle-knob" />
      </span>
      {label}
    </button>
  );
}
