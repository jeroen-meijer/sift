import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { OmniToggle } from "./OmniToggle";

interface Props {
  prefix: string;
  selected?: boolean;
  pending?: boolean;
  onSelect: () => void;
  onRemove: () => void;
  removeLabel: string;
  toggle?: { label: string; on: boolean; onToggle: () => void } | undefined;
  children: ReactNode;
}

/** Omni filter chip with optional inline toggle. */
export function OmniChip({
  prefix,
  selected,
  pending,
  onSelect,
  onRemove,
  removeLabel,
  toggle,
  children,
}: Props) {
  return (
    <span
      className={`omni-chip${selected ? " selected" : ""}${pending ? " pending" : ""}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        /* Select on down so the chip ring appears before the search field blurs. */
        e.preventDefault();
        e.stopPropagation();
        onSelect();
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <span className="omni-chip-pre">{prefix}</span>
      <span className="omni-chip-val mono">{children}</span>
      {toggle ? (
        <span
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <OmniToggle on={toggle.on} label={toggle.label} onToggle={toggle.onToggle} />
        </span>
      ) : null}
      <button
        type="button"
        className="omni-chip-x"
        aria-label={removeLabel}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <XIcon size={10} />
      </button>
    </span>
  );
}
