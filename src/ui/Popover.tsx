import { useEffect, useRef, type ReactNode } from "react";
import { keys, matchesBinding } from "../lib/bindings";

interface Props {
  onClose: () => void;
  align?: "left" | "right";
  label: string;
  children: ReactNode;
}

/**
 * A small anchored panel. The parent supplies `position: relative`.
 * Outside pointerdowns close it, except those that start on an ancestor
 * marked `data-popover-root` (the toggle). That stops the toggle from racing
 * outside-close against a click that should reopen it.
 */
export function Popover({ onClose, align = "right", label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (ref.current?.contains(target)) return;
      if (ref.current?.parentElement?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (matchesBinding(e, keys.dismiss)) onClose();
    };
    /* Defer so the opening click does not immediately close us. */
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", onPointerDown);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
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
