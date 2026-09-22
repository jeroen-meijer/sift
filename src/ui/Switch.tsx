interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}

/** The 34 × 19 pill toggle the settings rows use. */
export function Switch({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? " on" : ""}`}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="switch-knob" />
    </button>
  );
}
