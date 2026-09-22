import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  width: number;
  onClose: () => void;
  label: string;
  children: ReactNode;
}

/** Scrim + card. Escape closes; focus moves into the card on open. */
export function Dialog({ width, onClose, label, children }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    cardRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div className="dialog-scrim">
      <div
        ref={cardRef}
        className="dialog-card"
        style={{ width }}
        role="dialog"
        aria-modal
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
