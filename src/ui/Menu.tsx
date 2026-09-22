import { CaretRightIcon, CheckIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  FLYOUT_WIDTH,
  flyoutsGoLeft,
  placeFlyout,
  placeMenu,
  type Placement,
} from "./menuPlacement";
import { motionMs } from "./motion";

export interface MenuItem {
  kind: "item";
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
}

export interface MenuSubmenu {
  kind: "submenu";
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  options: { id: string; label: string; checked?: boolean }[];
}

/** A flyout holding real controls rather than a list of choices. */
export interface MenuPanel {
  kind: "panel";
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  width: number;
  content: ReactNode;
}

export type MenuEntry = { kind: "rule" } | MenuItem | MenuSubmenu | MenuPanel;

interface Props {
  x: number;
  y: number;
  entries: MenuEntry[];
  onSelect: (id: string) => void;
  onClose: () => void;
  label: string;
}

/** The design's 256px context menu, clamped to stay inside the window. */
export function Menu({ x, y, entries, onSelect, onClose, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);
  const [pos, setPos] = useState<Placement>({ left: x, top: y, maxHeight: 0 });
  const [flyoutPos, setFlyoutPos] = useState<Placement | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [flyoutsLeft, setFlyoutsLeft] = useState(false);

  /*
   * Flyouts open on hover but close on a delay. Without the grace period a
   * diagonal sweep from the trigger towards the flyout crosses a sibling row
   * and the flyout vanishes from under the pointer.
   */
  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
  }, []);

  const openFlyout = useCallback(
    (id: string) => {
      cancelClose();
      setOpenSub(id);
    },
    [cancelClose],
  );

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      setOpenSub(null);
    }, motionMs("--motion-hover-grace"));
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  const widestFlyout = entries.reduce(
    (widest, entry) => (entry.kind === "panel" ? Math.max(widest, entry.width) : widest),
    FLYOUT_WIDTH,
  );

  useLayoutEffect(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const placement = placeMenu(x, y, ref.current?.offsetHeight ?? 0, viewport);
    setPos(placement);
    setFlyoutsLeft(flyoutsGoLeft(placement.left, widestFlyout, viewport));
  }, [x, y, entries, widestFlyout]);

  /*
   * Flyouts are fixed and placed from their trigger's box rather than nested
   * inside it. An absolutely positioned flyout inherits the trigger's vertical
   * position, so a tall one runs straight off the bottom of the window — and
   * unlike a native menu, this one cannot draw outside it.
   */
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const flyout = flyoutRef.current;
    if (openSub == null || !trigger || !flyout) {
      setFlyoutPos(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setFlyoutPos(
      placeFlyout(
        rect,
        { width: flyout.offsetWidth, height: flyout.offsetHeight },
        flyoutsLeft,
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [openSub, flyoutsLeft, pos, entries]);

  useEffect(() => {
    const close = () => {
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpenSub((open) => {
        if (open == null) onClose();
        return null;
      });
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const pick = (id: string) => {
    onSelect(id);
    onClose();
  };

  /* Hidden for the first frame, while the layout effect measures and places it. */
  const flyoutStyle: React.CSSProperties = flyoutPos
    ? { left: flyoutPos.left, top: flyoutPos.top, maxHeight: flyoutPos.maxHeight }
    : { visibility: "hidden" };

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top, maxHeight: pos.maxHeight || undefined }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {entries.map((entry, index) =>
        entry.kind === "rule" ? (
          <div key={`rule-${String(index)}`} className="menu-rule" role="separator" />
        ) : entry.kind === "panel" ? (
          <div
            key={entry.id}
            className="menu-sub"
            ref={openSub === entry.id ? triggerRef : undefined}
            onMouseEnter={() => {
              if (!entry.disabled) openFlyout(entry.id);
            }}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={entry.disabled}
              aria-haspopup="true"
              aria-expanded={openSub === entry.id}
              onClick={(e) => {
                openFlyout(entry.id);
                // A deliberate click means the field is what you came for.
                e.currentTarget.parentElement?.querySelector("input")?.focus();
              }}
            >
              <span className="menu-icon">{entry.icon}</span>
              <span className="menu-label">{entry.label}</span>
              <CaretRightIcon size={12} weight="bold" className="menu-caret" />
            </button>
            {openSub === entry.id ? (
              <div
                ref={flyoutRef}
                className={`menu menu-flyout${flyoutsLeft ? " left" : ""}`}
                role="group"
                aria-label={entry.label}
                style={{ width: entry.width, ...flyoutStyle }}
                onMouseEnter={cancelClose}
              >
                {entry.content}
              </div>
            ) : null}
          </div>
        ) : entry.kind === "submenu" ? (
          <div
            key={entry.id}
            className="menu-sub"
            ref={openSub === entry.id ? triggerRef : undefined}
            onMouseEnter={() => {
              if (!entry.disabled) openFlyout(entry.id);
            }}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={entry.disabled}
              aria-haspopup="menu"
              aria-expanded={openSub === entry.id}
            >
              <span className="menu-icon">{entry.icon}</span>
              <span className="menu-label">{entry.label}</span>
              <CaretRightIcon size={12} weight="bold" className="menu-caret" />
            </button>
            {openSub === entry.id ? (
              <div
                ref={flyoutRef}
                className={`menu menu-flyout${flyoutsLeft ? " left" : ""}`}
                role="menu"
                aria-label={entry.label}
                style={flyoutStyle}
                onMouseEnter={cancelClose}
              >
                {entry.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={option.checked ?? false}
                    className="menu-item"
                    onClick={() => {
                      pick(option.id);
                    }}
                  >
                    <span className="menu-icon">
                      {option.checked ? <CheckIcon size={12} weight="bold" /> : null}
                    </span>
                    <span className="menu-label">{option.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            className={`menu-item${entry.danger ? " danger" : ""}`}
            disabled={entry.disabled}
            onMouseEnter={scheduleClose}
            onClick={() => {
              pick(entry.id);
            }}
          >
            <span className="menu-icon">{entry.icon}</span>
            <span className="menu-label">{entry.label}</span>
            {entry.hint ? <span className="menu-hint">{entry.hint}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}
