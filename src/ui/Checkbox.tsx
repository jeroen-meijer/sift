import { CheckIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  hint?: string;
}

/** The 15px square from the Custom analysis dialog. */
export function Checkbox({ checked, onChange, children, hint }: Props) {
  return (
    <label className="checkbox-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <span className="checkbox-box" aria-hidden>
        {checked ? <CheckIcon size={10} weight="bold" /> : null}
      </span>
      {children}
      {hint ? <span className="checkbox-hint">{hint}</span> : null}
    </label>
  );
}
