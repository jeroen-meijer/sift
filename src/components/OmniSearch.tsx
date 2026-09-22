import {
  ColumnsIcon,
  MagnifyingGlassIcon,
  StarIcon,
  WaveformIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { tagPalette } from "../lib/tagColors";
import {
  EMPTY_OMNI,
  OPTIONAL_COLUMNS,
  omniHasQuery,
  type OmniState,
  type OptionalColumn,
} from "../lib/omni";
import { Popover } from "../ui/Popover";

interface ChipProps {
  prefix: string;
  value: string;
  dot?: string;
  toggle?: { label: string; on: boolean; onToggle: () => void };
  onRemove: () => void;
  removeLabel: string;
}

function Chip({ prefix, value, dot, toggle, onRemove, removeLabel }: ChipProps) {
  return (
    <span className="omni-chip">
      {dot ? <span className="omni-chip-dot" style={{ background: dot }} /> : null}
      <span className="omni-chip-pre">{prefix}</span>
      <span className="omni-chip-val mono">{value}</span>
      {toggle ? (
        <button
          type="button"
          className={`omni-chip-toggle${toggle.on ? " on" : ""}`}
          aria-pressed={toggle.on}
          onClick={toggle.onToggle}
        >
          <span className="omni-chip-track">
            <span className="omni-chip-knob" />
          </span>
          {toggle.label}
        </button>
      ) : null}
      <button type="button" className="omni-chip-x" aria-label={removeLabel} onClick={onRemove}>
        <XIcon size={10} />
      </button>
    </span>
  );
}

interface Props {
  value: OmniState;
  onChange: (next: OmniState) => void;
  halfDouble: boolean;
  relativeKey: boolean;
  onToggleHalfDouble: () => void;
  onToggleRelativeKey: () => void;
  showWaveforms: boolean;
  onToggleWaveforms: () => void;
  favoritesOnly: boolean;
  onToggleFavoritesOnly: () => void;
  hiddenColumns: Set<OptionalColumn>;
  onToggleColumn: (column: OptionalColumn) => void;
  columnLabels: Record<OptionalColumn, string>;
}

export function OmniSearch({
  value,
  onChange,
  halfDouble,
  relativeKey,
  onToggleHalfDouble,
  onToggleRelativeKey,
  showWaveforms,
  onToggleWaveforms,
  favoritesOnly,
  onToggleFavoritesOnly,
  hiddenColumns,
  onToggleColumn,
  columnLabels,
}: Props) {
  const { t } = useTranslation("common");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const hasQuery = omniHasQuery(value);

  const chips: ReactNode[] = [];
  if (value.folder != null) {
    chips.push(
      <Chip
        key="folder"
        prefix={t("chipFolder")}
        value={value.folder}
        removeLabel={t("clear")}
        onRemove={() => {
          onChange({ ...value, folder: null });
        }}
      />,
    );
  }
  for (const tag of value.tags) {
    chips.push(
      <Chip
        key={`tag:${tag}`}
        prefix={t("chipTag")}
        value={tag}
        dot={tagPalette(tag, null).dot}
        removeLabel={t("clear")}
        onRemove={() => {
          onChange({ ...value, tags: value.tags.filter((x) => x !== tag) });
        }}
      />,
    );
  }
  if (value.bpmMin != null || value.bpmMax != null) {
    chips.push(
      <Chip
        key="bpm"
        prefix={t("chipBpm")}
        value={`${value.bpmMin ?? "…"}–${value.bpmMax ?? "…"}`}
        toggle={{ label: t("halfDouble"), on: halfDouble, onToggle: onToggleHalfDouble }}
        removeLabel={t("clear")}
        onRemove={() => {
          onChange({ ...value, bpmMin: null, bpmMax: null });
        }}
      />,
    );
  }
  if (value.key != null) {
    chips.push(
      <Chip
        key="key"
        prefix={t("chipKey")}
        value={value.key}
        toggle={{ label: t("relative"), on: relativeKey, onToggle: onToggleRelativeKey }}
        removeLabel={t("clear")}
        onRemove={() => {
          onChange({ ...value, key: null });
        }}
      />,
    );
  }

  const dropLastChip = () => {
    if (value.key != null) onChange({ ...value, key: null });
    else if (value.bpmMin != null || value.bpmMax != null)
      onChange({ ...value, bpmMin: null, bpmMax: null });
    else if (value.tags.length > 0) onChange({ ...value, tags: value.tags.slice(0, -1) });
    else if (value.folder != null) onChange({ ...value, folder: null });
  };

  return (
    <div className="omni-bar">
      <div className="omni-field">
        <MagnifyingGlassIcon size={14} className="omni-icon" />
        <div className="omni-chips">
          {chips}
          <input
            className="omni-input"
            value={value.text}
            placeholder={chips.length > 0 ? "" : t("searchPlaceholder")}
            onChange={(e) => {
              onChange({ ...value, text: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && value.text === "") dropLastChip();
            }}
          />
        </div>
        {hasQuery ? (
          <button
            type="button"
            className="omni-clear"
            aria-label={t("clear")}
            onClick={() => {
              onChange(EMPTY_OMNI);
            }}
          >
            <XCircleIcon size={14} />
          </button>
        ) : null}
      </div>
      <div className="omni-actions">
        <button
          type="button"
          className={`omni-tool-btn${showWaveforms ? " on" : ""}`}
          title={t("rowWaveforms")}
          aria-pressed={showWaveforms}
          onClick={onToggleWaveforms}
        >
          <WaveformIcon size={14} />
          {t("waveforms")}
        </button>
        <button
          type="button"
          className={`omni-icon-btn${favoritesOnly ? " on" : ""}`}
          title={t("favoritesOnly")}
          aria-label={t("favoritesOnly")}
          aria-pressed={favoritesOnly}
          onClick={onToggleFavoritesOnly}
        >
          <StarIcon size={15} weight={favoritesOnly ? "fill" : "regular"} />
        </button>
        <div className="omni-columns">
          <button
            type="button"
            className={`omni-icon-btn${columnsOpen ? " on" : ""}`}
            title={t("columns")}
            aria-label={t("columns")}
            aria-expanded={columnsOpen}
            onClick={() => {
              setColumnsOpen((open) => !open);
            }}
          >
            <ColumnsIcon size={15} />
          </button>
          {columnsOpen ? (
            <Popover
              label={t("columns")}
              onClose={() => {
                setColumnsOpen(false);
              }}
            >
              <div className="popover-label">{t("columns")}</div>
              {OPTIONAL_COLUMNS.map((column) => (
                <button
                  key={column}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={!hiddenColumns.has(column)}
                  onClick={() => {
                    onToggleColumn(column);
                  }}
                >
                  <span className="omni-column-mark">{hiddenColumns.has(column) ? "" : "✓"}</span>
                  {columnLabels[column]}
                </button>
              ))}
            </Popover>
          ) : null}
        </div>
      </div>
    </div>
  );
}
