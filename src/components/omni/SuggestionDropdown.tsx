import {
  ClockCounterClockwiseIcon,
  MetronomeIcon,
  MusicNotesIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { OmniTriggerKind } from "../../lib/omniQuery";
import { suggestMenuPlacement } from "../../lib/suggestPlacement";

export type SuggestionRow =
  | { id: string; kind: "trigger"; label: string; hint: string; trigger: OmniTriggerKind }
  | { id: string; kind: "recent"; label: string; recent: string }
  | { id: string; kind: "tag"; label: string; tagPath: string };

interface Props {
  rows: SuggestionRow[];
  highlight: number;
  emptyField: boolean;
  /** Text input. Menu top-left follows its left edge when space allows. */
  anchorRef: RefObject<HTMLElement | null>;
  onHighlight: (index: number) => void;
  onPick: (row: SuggestionRow) => void;
}

const TRIGGER_ICON: Record<OmniTriggerKind, typeof TagIcon> = {
  tag: TagIcon,
  bpm: MetronomeIcon,
  key: MusicNotesIcon,
  type: MusicNotesIcon,
};

export function SuggestionDropdown({
  rows,
  highlight,
  emptyField,
  anchorRef,
  onHighlight,
  onPick,
}: Props) {
  const { t } = useTranslation("common");
  const rootRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(() =>
    suggestMenuPlacement({
      anchorLeft: 0,
      anchorBottom: 0,
      viewportWidth: typeof window !== "undefined" ? window.innerWidth : 800,
    }),
  );

  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPlace(
        suggestMenuPlacement({
          anchorLeft: rect.left,
          anchorBottom: rect.bottom,
          viewportWidth: window.innerWidth,
        }),
      );
    };
    update();
    window.addEventListener("resize", update);
    const anchor = anchorRef.current;
    const field = anchor?.closest(".omni-field");
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (ro && anchor) ro.observe(anchor);
    if (ro && field) ro.observe(field);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, [anchorRef, rows.length, emptyField]);

  if (rows.length === 0 && !emptyField) return null;

  return (
    <div
      ref={rootRef}
      className="omni-suggest"
      role="listbox"
      style={{
        left: place.left,
        top: place.top,
        width: place.width,
      }}
    >
      {emptyField ? (
        <div className="omni-suggest-section">{t("omni.suggest.filters")}</div>
      ) : null}
      {rows.map((row, i) => {
        const Icon =
          row.kind === "recent"
            ? ClockCounterClockwiseIcon
            : row.kind === "tag"
              ? TagIcon
              : TRIGGER_ICON[row.trigger];
        return (
          <button
            key={row.id}
            type="button"
            role="option"
            aria-selected={i === highlight}
            className={`omni-suggest-row${i === highlight ? " hi" : ""}`}
            onMouseEnter={() => {
              onHighlight(i);
            }}
            onClick={() => {
              onPick(row);
            }}
          >
            <Icon size={13} />
            <span className="omni-suggest-label">{row.label}</span>
            {row.kind === "trigger" ? (
              <span className="omni-suggest-hint mono">{row.hint}</span>
            ) : null}
          </button>
        );
      })}
      {emptyField ? (
        <div className="omni-suggest-footer">{t("omni.suggest.footer")}</div>
      ) : null}
    </div>
  );
}
