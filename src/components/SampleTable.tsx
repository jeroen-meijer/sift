import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CaretDownIcon,
  CaretUpIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  StarIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatCount } from "../lib/format";
import type { SampleRow, SortColumn, SortDirection } from "../lib/ipc";
import { tagPalette } from "../lib/tagColors";
import type { OptionalColumn } from "../lib/omni";
import { RowWaveform } from "./RowWaveform";

const ROW_HEIGHT = 28;
const EM_DASH = "—";

/** Column widths straight from the design grid. */
const COLUMN_WIDTH: Record<OptionalColumn | "fav" | "name" | "wave", string> = {
  fav: "26px",
  name: "minmax(170px, 1.3fr)",
  type: "58px",
  bpm: "46px",
  key: "54px",
  wave: "minmax(150px, 1.2fr)",
  tags: "210px",
};

function gridTemplate(hidden: Set<OptionalColumn>, showWaveforms: boolean): string {
  const columns = ["fav", "name"] as (OptionalColumn | "fav" | "name" | "wave")[];
  for (const column of ["type", "bpm", "key"] as const) {
    if (!hidden.has(column)) columns.push(column);
  }
  if (showWaveforms) columns.push("wave");
  if (!hidden.has("tags")) columns.push("tags");
  return columns.map((c) => COLUMN_WIDTH[c]).join(" ");
}

function highlight(name: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle) return name;
  const at = name.toLowerCase().indexOf(needle);
  if (at < 0) return name;
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + needle.length)}</mark>
      {name.slice(at + needle.length)}
    </>
  );
}

interface Props {
  samples: SampleRow[];
  indexedCount: number;
  selectedIds: Set<number>;
  playingId: number | null;
  /** 0–1 position of the playhead in the playing row. */
  playingProgress: number | null;
  analyzingIds: Set<number>;
  showWaveforms: boolean;
  hiddenColumns: Set<OptionalColumn>;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  highlightText: string;
  hoverPreviewHeld: boolean;
  onSelect: (id: number, e: React.MouseEvent) => void;
  onHoverPreview: (id: number) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
  onSort: (column: SortColumn) => void;
  onOpenMenu: (x: number, y: number, sample: SampleRow) => void;
  onDragSelected: () => void;
  onScrubRow: (sample: SampleRow, fraction: number) => void;
}

export function SampleTable({
  samples,
  indexedCount,
  selectedIds,
  playingId,
  playingProgress,
  analyzingIds,
  showWaveforms,
  hiddenColumns,
  sortColumn,
  sortDirection,
  highlightText,
  hoverPreviewHeld,
  onSelect,
  onHoverPreview,
  onToggleFavorite,
  onSort,
  onOpenMenu,
  onDragSelected,
  onScrubRow,
}: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: samples.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const template = gridTemplate(hiddenColumns, showWaveforms);

  const header = (column: SortColumn, label: string) => {
    const active = sortColumn === column;
    return (
      <button
        type="button"
        className="col"
        aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
        onClick={() => {
          onSort(column);
        }}
      >
        {label}
        {active ? (
          sortDirection === "asc" ? (
            <CaretUpIcon size={8} weight="bold" className="sort-mark" />
          ) : (
            <CaretDownIcon size={8} weight="bold" className="sort-mark" />
          )
        ) : null}
      </button>
    );
  };

  return (
    <div className="sample-table">
      <div className="sample-table-header" style={{ gridTemplateColumns: template }}>
        <span />
        {header("name", t("colName"))}
        {hiddenColumns.has("type") ? null : header("type", t("colType"))}
        {hiddenColumns.has("bpm") ? null : header("bpm", t("colBpm"))}
        {hiddenColumns.has("key") ? null : header("key", t("colKey"))}
        {showWaveforms ? <span className="col">{t("colWaveform")}</span> : null}
        {hiddenColumns.has("tags") ? null : <span className="col">{t("colTags")}</span>}
      </div>

      <div className="sample-table-body" ref={scrollRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtual) => {
            const sample = samples[virtual.index];
            if (!sample) return null;
            const selected = selectedIds.has(sample.id);
            const analyzing = analyzingIds.has(sample.id);
            const playing = playingId === sample.id;
            return (
              <div
                key={sample.id}
                className={`sample-row${selected ? " selected" : ""}${sample.missing ? " missing" : ""}`}
                style={{
                  gridTemplateColumns: template,
                  transform: `translateY(${virtual.start}px)`,
                }}
                draggable={!sample.missing}
                onDragStart={(e) => {
                  if (sample.missing) {
                    e.preventDefault();
                    return;
                  }
                  if (!selectedIds.has(sample.id)) onSelect(sample.id, e);
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData("text/plain", sample.path);
                  onDragSelected();
                }}
                onClick={(e) => {
                  onSelect(sample.id, e);
                }}
                onMouseEnter={() => {
                  if (hoverPreviewHeld && !sample.missing) onHoverPreview(sample.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selectedIds.has(sample.id)) onSelect(sample.id, e);
                  onOpenMenu(e.clientX, e.clientY, sample);
                }}
              >
                <button
                  type="button"
                  className="col fav"
                  aria-label={sample.favorite ? tc("ctxUnfavorite") : tc("ctxFavorite")}
                  aria-pressed={sample.favorite}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(sample.id, !sample.favorite);
                  }}
                >
                  <StarIcon size={11} weight={sample.favorite ? "fill" : "regular"} />
                </button>

                <div className="col name" title={sample.path}>
                  {playing ? <PlayIcon size={8} weight="fill" className="row-playing" /> : null}
                  {sample.missing ? (
                    <WarningCircleIcon size={11} weight="fill" className="row-missing-icon" />
                  ) : null}
                  <span className="name-text">{highlight(sample.filename, highlightText)}</span>
                </div>

                {hiddenColumns.has("type") ? null : (
                  <div className="col type">{sample.missing ? "" : (sample.sample_type ?? "")}</div>
                )}
                {hiddenColumns.has("bpm") ? null : (
                  <div className="col mono-cell">
                    {sample.bpm == null ? EM_DASH : Math.round(sample.bpm)}
                  </div>
                )}
                {hiddenColumns.has("key") ? null : (
                  <div className="col mono-cell">{sample.key_name ?? EM_DASH}</div>
                )}

                {showWaveforms ? (
                  <div className="col wave">
                    <RowWaveform
                      sampleId={sample.id}
                      missing={sample.missing}
                      analyzing={analyzing}
                      selected={selected}
                      progress={playing ? playingProgress : null}
                      onScrub={(fraction) => {
                        onScrubRow(sample, fraction);
                      }}
                    />
                  </div>
                ) : null}

                {hiddenColumns.has("tags") ? null : (
                  <div className="col tags">
                    {analyzing ? (
                      <span className="analyzing-label">{tc("statusAnalyzing")}</span>
                    ) : (
                      sample.tags.map((tag) => {
                        const palette = tagPalette(tag.path, tag.color);
                        return (
                          <span
                            key={tag.id}
                            className="tag-chip"
                            style={{ background: palette.bg, color: palette.fg }}
                          >
                            {tag.path}
                          </span>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {samples.length === 0 ? (
            <div className="sample-table-empty">
              <div>
                <MagnifyingGlassIcon size={26} />
                <div className="sample-table-empty-title">{t("emptyTitle")}</div>
                <div className="sample-table-empty-body">
                  {t("emptyBody")}
                  <br />
                  {t("emptyCount", {
                    count: indexedCount,
                    formatted: formatCount(indexedCount),
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
