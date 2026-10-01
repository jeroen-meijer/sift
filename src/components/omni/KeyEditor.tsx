import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { KeyMode, OmniKey } from "../../lib/omni";
import {
  ACCIDENTAL_COLS,
  ACCIDENTAL_LABELS,
  NOTES,
  parseOmniKey,
  relativeKeyLabel,
  serializeOmniKeyBody,
} from "../../lib/omniKey";
import { OmniEditorChrome } from "./OmniEditorChrome";
import { OmniToggle } from "./OmniToggle";

interface Props {
  value: OmniKey | null;
  relative: boolean;
  /** Counts per pitch class 0–11 under other filters. */
  rootCounts: number[];
  onChange: (next: OmniKey | null) => void;
  onToggleRelative: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const MODES: { id: KeyMode; labelKey: string }[] = [
  { id: "either", labelKey: "omni.editor.modeEither" },
  { id: "maj", labelKey: "omni.editor.modeMaj" },
  { id: "min", labelKey: "omni.editor.modeMin" },
];

export function KeyEditor({
  value,
  relative,
  rootCounts,
  onChange,
  onToggleRelative,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState(() =>
    value ? serializeOmniKeyBody(value).replace(/maj$/, "") : "",
  );

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const parsed = value ?? parseOmniKey(raw);
  const syntax = parsed ? `k:${serializeOmniKeyBody(parsed)}` : "k:";
  const relLabel = parsed ? relativeKeyLabel(parsed) : null;

  const setFrom = (pc: number, mode: KeyMode) => {
    const next: OmniKey = { pitchClass: pc, mode };
    onChange(next);
    const body = serializeOmniKeyBody(next);
    setRaw(mode === "maj" ? body.replace(/maj$/, "") : body);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const countFor = (pc: number) => rootCounts[pc] ?? 0;

  return (
    <OmniEditorChrome keysHint={t("omni.editor.keyKeys")} syntax={syntax}>
      <div className="omni-key-row">
        <span className="omni-editor-label">{t("omni.chip.key")}</span>
        <input
          ref={inputRef}
          className="omni-key-input mono"
          spellCheck={false}
          placeholder={t("omni.editor.keyPlaceholder")}
          value={raw}
          onChange={(e) => {
            const next = e.target.value;
            setRaw(next);
            onChange(parseOmniKey(next));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
              return;
            }
            if (e.key === "Enter" || e.key === "Tab" || e.key === " ") {
              e.preventDefault();
              onConfirm();
            }
          }}
        />
      </div>

      <div className="omni-piano">
        <div className="omni-piano-row blacks">
          {ACCIDENTAL_LABELS.map((acc, i) => {
            const col = ACCIDENTAL_COLS[i] ?? 2;
            const on = parsed?.pitchClass === acc.pc;
            const count = countFor(acc.pc);
            return (
              <div
                key={acc.pc}
                className="omni-piano-cell span2"
                style={{ gridColumn: `${String(col)} / span 2` }}
              >
                <button
                  type="button"
                  className={`omni-piano-key${on ? " on" : ""}${count === 0 ? " zero" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={() => {
                    setFrom(acc.pc, parsed?.mode ?? "either");
                  }}
                >
                  {acc.label}
                  <span>{String(count)}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="omni-piano-row whites">
          {NOTES.filter((_, pc) => ![1, 3, 6, 8, 10].includes(pc)).map((label) => {
            const pc = NOTES.indexOf(label);
            const on = parsed?.pitchClass === pc;
            const count = countFor(pc);
            return (
              <div key={label} className="omni-piano-cell span2">
                <button
                  type="button"
                  className={`omni-piano-key${on ? " on" : ""}${count === 0 ? " zero" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={() => {
                    setFrom(pc, parsed?.mode ?? "either");
                  }}
                >
                  {label}
                  <span>{String(count)}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="omni-key-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`omni-key-mode${(parsed?.mode ?? "either") === m.id ? " on" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            onClick={() => {
              const pc = parsed?.pitchClass ?? 0;
              setFrom(pc, m.id);
            }}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>

      {parsed && parsed.mode !== "either" && relLabel ? (
        <OmniToggle
          on={relative}
          label={t("omni.editor.includeRelative", { key: relLabel })}
          onToggle={onToggleRelative}
        />
      ) : null}
    </OmniEditorChrome>
  );
}
