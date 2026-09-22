import { CaretRightIcon, CheckIcon } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { keys, matchesBinding } from "../lib/bindings";
import {
  FLYOUT_WIDTH,
  flyoutsGoLeft,
  placeFlyout,
  placeMenu,
  type Placement,
} from "./menuPlacement";
import { motionMs } from "./motion";
import { ShortcutHint } from "./ShortcutHint";

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
  hint?: string;
  disabled?: boolean;
  options: { id: string; label: string; checked?: boolean }[];
}

/** A flyout holding real controls, not a list of choices. */
export interface MenuPanel {
  kind: "panel";
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string;
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
  /**
   * Open this submenu/panel on mount. With `panelOnly`, the root list is
   * skipped and only that panel is shown (keyboard Set key / Set BPM).
   */
  initialOpen?: string;
  panelOnly?: boolean;
}

/** The design's 256px context menu, clamped to stay inside the window. */
export function Menu({
  x,
  y,
  entries,
  onSelect,
  onClose,
  label,
  initialOpen,
  panelOnly = false,
}: Props) {
  const panelEntry =
    panelOnly && initialOpen
      ? entries.find(
          (entry): entry is MenuPanel => entry.kind === "panel" && entry.id === initialOpen,
        )
      : undefined;

  if (panelEntry) {
    return (
      <PanelOnlyMenu
        x={x}
        y={y}
        width={panelEntry.width}
        label={panelEntry.label}
        onClose={onClose}
      >
        {panelEntry.content}
      </PanelOnlyMenu>
    );
  }

  return (
    <RootMenu
      x={x}
      y={y}
      entries={entries}
      onSelect={onSelect}
      onClose={onClose}
      label={label}
      {...(initialOpen != null ? { initialOpen } : {})}
    />
  );
}

/** Standalone panel (Set key / Set BPM) sitting where a context menu would. */
function PanelOnlyMenu({
  x,
  y,
  width,
  label,
  onClose,
  children,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Placement>({ left: x, top: y, maxHeight: 0 });

  useLayoutEffect(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setPos(placeMenu(x, y, ref.current?.offsetHeight ?? 0, viewport, width));
  }, [x, y, width]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesBinding(e, keys.dismiss)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="menu"
      role="group"
      aria-label={label}
      style={{
        left: pos.left,
        top: pos.top,
        width,
        maxHeight: pos.maxHeight || undefined,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

function RootMenu({
  x,
  y,
  entries,
  onSelect,
  onClose,
  label,
  initialOpen,
}: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onSelect: (id: string) => void;
  onClose: () => void;
  label: string;
  initialOpen?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);
  const exitTimer = useRef(0);
  const [pos, setPos] = useState<Placement>({ left: x, top: y, maxHeight: 0 });
  const [flyoutPos, setFlyoutPos] = useState<Placement | null>(null);
  /** Logical open target (null while closing or idle). */
  const [openSub, setOpenSub] = useState<string | null>(initialOpen ?? null);
  /** What stays mounted through the exit animation. */
  const [mountedSub, setMountedSub] = useState<string | null>(initialOpen ?? null);
  const [leaving, setLeaving] = useState(false);
  const [flyoutsLeft, setFlyoutsLeft] = useState(false);
  const didInitialFocus = useRef(false);

  /*
   * Flyouts open on hover and close after a short delay. The delay keeps a
   * diagonal sweep from the trigger to the flyout from closing it when the
   * pointer crosses a sibling row.
   */
  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
  }, []);

  const openFlyout = useCallback(
    (id: string) => {
      cancelClose();
      window.clearTimeout(exitTimer.current);
      setLeaving(false);
      setOpenSub(id);
      setMountedSub(id);
    },
    [cancelClose],
  );

  const beginCloseFlyout = useCallback(() => {
    setOpenSub(null);
    setLeaving(true);
    window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(() => {
      setMountedSub(null);
      setLeaving(false);
    }, motionMs("--motion-base"));
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      beginCloseFlyout();
    }, motionMs("--motion-hover-grace"));
  }, [beginCloseFlyout, cancelClose]);

  useEffect(
    () => () => {
      cancelClose();
      window.clearTimeout(exitTimer.current);
    },
    [cancelClose],
  );

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
   * Flyouts are portaled to document.body and placed from the trigger's box.
   * Nesting position:fixed inside .menu breaks on WebKit when the menu has
   * overflow scrolling. Transform on the flyout itself is fine once portaled.
   */
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const flyout = flyoutRef.current;
    if (mountedSub == null || !trigger || !flyout) {
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
  }, [mountedSub, flyoutsLeft, pos, entries]);

  /* Focus the panel search when opened via keyboard (or click). */
  useEffect(() => {
    if (!initialOpen || didInitialFocus.current) return;
    if (mountedSub !== initialOpen || flyoutPos == null) return;
    didInitialFocus.current = true;
    const input = flyoutRef.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [flyoutPos, initialOpen, mountedSub]);

  useEffect(() => {
    const close = () => {
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!matchesBinding(e, keys.dismiss)) return;
      e.preventDefault();
      e.stopPropagation();
      if (openSub != null || mountedSub != null) {
        beginCloseFlyout();
        return;
      }
      onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (flyoutRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [beginCloseFlyout, mountedSub, onClose, openSub]);

  const pick = (id: string) => {
    onSelect(id);
    onClose();
  };

  /* Hidden for the first frame, while the layout effect measures and places it. */
  const flyoutStyle: CSSProperties = flyoutPos
    ? { left: flyoutPos.left, top: flyoutPos.top, maxHeight: flyoutPos.maxHeight }
    : { visibility: "hidden" };

  const renderFlyout = (entry: MenuSubmenu | MenuPanel) => {
    if (mountedSub !== entry.id) return null;
    const isPanel = entry.kind === "panel";
    return createPortal(
      <div
        ref={flyoutRef}
        className={`menu menu-flyout${flyoutsLeft ? " left" : ""}${leaving ? " leaving" : ""}`}
        role={isPanel ? "group" : "menu"}
        aria-label={entry.label}
        style={isPanel ? { width: entry.width, ...flyoutStyle } : flyoutStyle}
        onMouseEnter={() => {
          if (!leaving) cancelClose();
        }}
        onMouseLeave={scheduleClose}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
      >
        {isPanel
          ? entry.content
          : entry.options.map((option) => (
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
      </div>,
      document.body,
    );
  };

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
        ) : entry.kind === "panel" || entry.kind === "submenu" ? (
          <div
            key={entry.id}
            className="menu-sub"
            ref={mountedSub === entry.id ? triggerRef : undefined}
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
              aria-haspopup={entry.kind === "panel" ? "true" : "menu"}
              aria-expanded={openSub === entry.id}
              onClick={() => {
                openFlyout(entry.id);
                if (entry.kind === "panel") {
                  requestAnimationFrame(() => {
                    const input = flyoutRef.current?.querySelector("input");
                    input?.focus();
                    input?.select();
                  });
                }
              }}
            >
              <span className="menu-icon">{entry.icon}</span>
              <span className="menu-label">{entry.label}</span>
              {entry.hint ? <ShortcutHint hint={entry.hint} /> : null}
              <CaretRightIcon size={12} weight="bold" className="menu-caret" />
            </button>
            {renderFlyout(entry)}
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
            {entry.hint ? <ShortcutHint hint={entry.hint} /> : null}
          </button>
        ),
      )}
    </div>
  );
}
