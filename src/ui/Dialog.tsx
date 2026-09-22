import { useEffect, useRef, type ReactNode } from "react";
import { keys, matchesBinding } from "../lib/bindings";

interface Props {
  width: number;
  onClose: () => void;
  label: string;
  /** Extra class on the card (e.g. settings shell). */
  className?: string;
  /** Skip the default card padding when the child brings its own chrome. */
  bare?: boolean;
  children: ReactNode;
}

/**
 * Scrim + card. Escape closes. Backdrop closes on click (not pointerdown) so
 * the same gesture cannot fall through to whatever was underneath once the
 * dialog unmounts.
 */
export function Dialog({ width, onClose, label, className, bare = false, children }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesBinding(e, keys.dismiss)) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    cardRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      className="dialog-scrim"
      onPointerDown={(e) => {
        /* Eat the gesture so it cannot reach the app under the scrim. */
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        ref={cardRef}
        className={`dialog-card${bare ? " bare" : ""}${className ? ` ${className}` : ""}`}
        style={{ width }}
        role="dialog"
        aria-modal
        aria-label={label}
        tabIndex={-1}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
}
