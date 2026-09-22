import { CheckIcon } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

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

export type MenuEntry = { kind: "rule" } | MenuItem | MenuSubmenu;

interface Props {
  x: number;
  y: number;
  entries: MenuEntry[];
  onSelect: (id: string) => void;
  onClose: () => void;
  label: string;
}

const MENU_WIDTH = 256;
const EDGE_GAP = 8;

/** The design's 256px context menu, clamped to stay inside the window. */
export function Menu({ x, y, entries, onSelect, onClose, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<string | null>(null);

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    setPos({
      left: Math.min(x, window.innerWidth - MENU_WIDTH - EDGE_GAP),
      top: Math.max(EDGE_GAP, Math.min(y, window.innerHeight - height - EDGE_GAP)),
    });
  }, [x, y, entries]);

  useEffect(() => {
    const close = () => {
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const pick = (id: string) => {
    onSelect(id);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      {entries.map((entry, index) =>
        entry.kind === "rule" ? (
          <div key={`rule-${String(index)}`} className="menu-rule" role="separator" />
        ) : entry.kind === "submenu" ? (
          <div
            key={entry.id}
            className="menu-sub"
            onMouseEnter={() => {
              setOpenSub(entry.id);
            }}
            onMouseLeave={() => {
              setOpenSub((prev) => (prev === entry.id ? null : prev));
            }}
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
              <span className="menu-hint">▸</span>
            </button>
            {openSub === entry.id ? (
              <div className="menu menu-flyout" role="menu" aria-label={entry.label}>
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
