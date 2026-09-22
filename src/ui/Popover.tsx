import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  onClose: () => void;
  align?: "left" | "right";
  label: string;
  children: ReactNode;
}

/** A small anchored panel. The parent supplies `position: relative`. */
export function Popover({ onClose, align = "right", label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={`popover popover-${align}`} role="group" aria-label={label}>
      {children}
    </div>
  );
}
