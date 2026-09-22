import { MagnifyingGlassIcon, XCircleIcon, XIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export interface OmniState {
  text: string;
  folder: string | null;
  tags: string[];
  bpmMin: number | null;
  bpmMax: number | null;
  key: string | null;
  halfDouble: boolean;
  relativeKey: boolean;
}

interface Props {
  value: OmniState;
  onChange: (next: OmniState) => void;
  onToggleHalfDouble: () => void;
  onToggleRelativeKey: () => void;
}

export function OmniSearch({
  value,
  onChange,
  onToggleHalfDouble,
  onToggleRelativeKey,
}: Props) {
  const { t } = useTranslation("common");
  const hasQuery =
    value.text.length > 0 ||
    value.folder != null ||
    value.tags.length > 0 ||
    value.bpmMin != null ||
    value.bpmMax != null ||
    value.key != null;

  const clearAll = () =>
    void onChange({
      ...value,
      text: "",
      folder: null,
      tags: [],
      bpmMin: null,
      bpmMax: null,
      key: null,
    });

  return (
    <div className="omni-bar">
      <div className="omni-field">
        <MagnifyingGlassIcon size={14} className="omni-icon" />
        <div className="omni-chips">
          {value.folder ? (
            <span className="omni-chip">
              <span className="omni-chip-pre">{t("chipFolder")}</span>
              <span className="omni-chip-val mono">{value.folder}</span>
              <button
                type="button"
                className="omni-chip-x"
                aria-label={t("clear")}
                onClick={() => void onChange({ ...value, folder: null })}
              >
                <XIcon size={10} />
              </button>
            </span>
          ) : null}
          {value.tags.map((tag) => (
            <span key={tag} className="omni-chip">
              <span className="omni-chip-dot" />
              <span className="omni-chip-pre">{t("chipTag")}</span>
              <span className="omni-chip-val mono">{tag}</span>
              <button
                type="button"
                className="omni-chip-x"
                aria-label={t("clear")}
                onClick={() =>
                  void onChange({ ...value, tags: value.tags.filter((x) => x !== tag) })
                }
              >
                <XIcon size={10} />
              </button>
            </span>
          ))}
          {value.bpmMin != null || value.bpmMax != null ? (
            <span className="omni-chip">
              <span className="omni-chip-pre">{t("chipBpm")}</span>
              <span className="omni-chip-val mono">
                {value.bpmMin ?? "…"}–{value.bpmMax ?? "…"}
              </span>
              <button
                type="button"
                className={`omni-toggle${value.halfDouble ? " on" : ""}`}
                onClick={onToggleHalfDouble}
                title={t("halfDouble")}
              >
                {t("halfDoubleShort")}
              </button>
              <button
                type="button"
                className="omni-chip-x"
                aria-label={t("clear")}
                onClick={() => void onChange({ ...value, bpmMin: null, bpmMax: null })}
              >
                <XIcon size={10} />
              </button>
            </span>
          ) : null}
          {value.key ? (
            <span className="omni-chip">
              <span className="omni-chip-pre">{t("chipKey")}</span>
              <span className="omni-chip-val mono">{value.key}</span>
              <button
                type="button"
                className={`omni-toggle${value.relativeKey ? " on" : ""}`}
                onClick={onToggleRelativeKey}
                title={t("relativeKey")}
              >
                {t("relativeShort")}
              </button>
              <button
                type="button"
                className="omni-chip-x"
                aria-label={t("clear")}
                onClick={() => void onChange({ ...value, key: null })}
              >
                <XIcon size={10} />
              </button>
            </span>
          ) : null}
          <input
            className="omni-input"
            value={value.text}
            placeholder={hasQuery ? "" : t("searchPlaceholder")}
            onChange={(e) => void onChange({ ...value, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && value.text === "") {
                if (value.key) onChange({ ...value, key: null });
                else if (value.bpmMin != null || value.bpmMax != null)
                  onChange({ ...value, bpmMin: null, bpmMax: null });
                else if (value.tags.length)
                  onChange({ ...value, tags: value.tags.slice(0, -1) });
                else if (value.folder) onChange({ ...value, folder: null });
              }
            }}
          />
        </div>
        {hasQuery ? (
          <button type="button" className="omni-clear" onClick={clearAll} aria-label={t("clear")}>
            <XCircleIcon size={14} />
          </button>
        ) : null}
      </div>
      <div className="omni-actions">
        <button
          type="button"
          className={`omni-toggle-btn${value.halfDouble ? " on" : ""}`}
          onClick={onToggleHalfDouble}
          title={t("halfDouble")}
        >
          {t("halfDoubleShort")}
        </button>
        <button
          type="button"
          className={`omni-toggle-btn${value.relativeKey ? " on" : ""}`}
          onClick={onToggleRelativeKey}
          title={t("relativeKey")}
        >
          {t("relativeShort")}
        </button>
      </div>
    </div>
  );
}
