import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CaretDownIcon,
  CaretUpIcon,
  CircleNotchIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  StarIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  clampColumnWidth,
  FAV_COLUMN_WIDTH,
  type ColumnWidths,
  type ResizableColumn,
} from "../lib/columnWidths";
import { formatCount } from "../lib/format";
import type { SampleRow, SortColumn, SortDirection } from "../lib/ipc";
import { tagPalette } from "../lib/tagColors";
import type { OptionalColumn } from "../lib/omni";
import { prefetchRowPeaks } from "../lib/rowPeaks";
import { RowWaveform } from "./RowWaveform";

const ROW_HEIGHT = 28;
/** Extra rows above/below the viewport so scroll rarely paints an empty slot. */
const ROW_OVERSCAN = 40;
/** Prefetch peaks this far past the overscan window (first-pass scroll). */
const PEAK_PREFETCH_PAD = 80;
const EM_DASH = "—";

function visibleColumns(hidden: Set<OptionalColumn>, showWaveforms: boolean): ResizableColumn[] {
  const columns: ResizableColumn[] = ["name"];
  for (const column of ["type", "bpm", "key"] as const) {
    if (!hidden.has(column)) columns.push(column);
  }
  if (showWaveforms) columns.push("wave");
  if (!hidden.has("tags")) columns.push("tags");
  return columns;
}

function gridTemplate(
  hidden: Set<OptionalColumn>,
  showWaveforms: boolean,
  widths: ColumnWidths,
): string {
  const parts = [`${String(FAV_COLUMN_WIDTH)}px`];
  for (const column of visibleColumns(hidden, showWaveforms)) {
    parts.push(`${String(widths[column])}px`);
  }
  /* Absorb leftover width so the table still fills the pane. */
  parts.push("minmax(0, 1fr)");
  return parts.join(" ");
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

/** Split `kick.wav` so the extension can sit in a quieter span. */
function splitFilename(filename: string): { base: string; ext: string } {
  const at = filename.lastIndexOf(".");
  if (at <= 0 || at === filename.length - 1) return { base: filename, ext: "" };
  return { base: filename.slice(0, at), ext: filename.slice(at) };
}

interface Props {
  samples: SampleRow[];
  indexedCount: number;
  /** True while the first (or empty) list query is in flight. */
  loading?: boolean;
  selectedIds: Set<number>;
  playingId: number | null;
  /** 0-1 position of the playhead in the playing row. */
  playingProgress: number | null;
  analyzingIds: Set<number>;
  showWaveforms: boolean;
  coloredWaveforms: boolean;
  hiddenColumns: Set<OptionalColumn>;
  columnWidths: ColumnWidths;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  highlightText: string;
  hoverPreviewHeld: boolean;
  onSelect: (id: number, e: React.MouseEvent) => void;
  onHoverPreview: (id: number) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
  onSort: (column: SortColumn) => void;
  onColumnWidthsChange: (widths: ColumnWidths) => void;
  onOpenMenu: (x: number, y: number, sample: SampleRow) => void;
  onDragSelected: () => void;
  onScrubRow: (sample: SampleRow, fraction: number) => void;
}

export function SampleTable({
  samples,
  indexedCount,
  loading = false,
  selectedIds,
  playingId,
  playingProgress,
  analyzingIds,
  showWaveforms,
  coloredWaveforms,
  hiddenColumns,
  columnWidths,
  sortColumn,
  sortDirection,
  highlightText,
  hoverPreviewHeld,
  onSelect,
  onHoverPreview,
  onToggleFavorite,
  onSort,
  onColumnWidthsChange,
  onOpenMenu,
  onDragSelected,
  onScrubRow,
}: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    column: ResizableColumn;
    startX: number;
    startWidth: number;
  } | null>(null);
  const widthsRef = useRef(columnWidths);
  widthsRef.current = columnWidths;

  const virtualizer = useVirtualizer({
    count: samples.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: ROW_OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const rangeStart = virtualItems[0]?.index ?? 0;
  const rangeEnd = virtualItems.at(-1)?.index ?? -1;

  /* Prefetch peaks for the mounted window + lookahead so first scroll stays warm. */
  useEffect(() => {
    if (!showWaveforms || samples.length === 0) return;
    const last = samples.length - 1;
    const urgentStart = rangeEnd < rangeStart ? 0 : rangeStart;
    const urgentEnd = rangeEnd < rangeStart ? Math.min(last, 40) : rangeEnd;
    const urgentIds: number[] = [];
    for (let index = urgentStart; index <= urgentEnd; index++) {
      const sample = samples[index];
      if (sample && !sample.missing) urgentIds.push(sample.id);
    }
    prefetchRowPeaks(urgentIds, { urgent: true });

    const padStart = Math.max(0, urgentStart - PEAK_PREFETCH_PAD);
    const padEnd = Math.min(last, urgentEnd + PEAK_PREFETCH_PAD);
    const warmIds: number[] = [];
    for (let index = padStart; index <= padEnd; index++) {
      if (index >= urgentStart && index <= urgentEnd) continue;
      const sample = samples[index];
      if (sample && !sample.missing) warmIds.push(sample.id);
    }
    prefetchRowPeaks(warmIds);
  }, [showWaveforms, samples, rangeStart, rangeEnd]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = clampColumnWidth(drag.column, drag.startWidth + (e.clientX - drag.startX));
      onColumnWidthsChange({ ...widthsRef.current, [drag.column]: next });
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.classList.remove("col-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onColumnWidthsChange]);

  const template = gridTemplate(hiddenColumns, showWaveforms, columnWidths);

  const startResize = (column: ResizableColumn, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      column,
      startX: e.clientX,
      startWidth: widthsRef.current[column],
    };
    document.body.classList.add("col-resizing");
  };

  const header = (column: "name" | "type" | "bpm" | "key", label: string) => {
    const active = sortColumn === column;
    return (
      <div className="col-header">
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
        <button
          type="button"
          className="col-resize"
          tabIndex={-1}
          aria-label={t("resizeColumn", { column: label })}
          onPointerDown={(e) => {
            startResize(column, e);
          }}
        />
      </div>
    );
  };

  const plainHeader = (column: ResizableColumn, label: string) => (
    <div className="col-header">
      <span className="col">{label}</span>
      <button
        type="button"
        className="col-resize"
        tabIndex={-1}
        aria-label={t("resizeColumn", { column: label })}
        onPointerDown={(e) => {
          startResize(column, e);
        }}
      />
    </div>
  );

  return (
    <div className="sample-table">
      <div className="sample-table-header" style={{ gridTemplateColumns: template }}>
        <span />
        {header("name", t("colName"))}
        {hiddenColumns.has("type") ? null : header("type", t("colType"))}
        {hiddenColumns.has("bpm") ? null : header("bpm", t("colBpm"))}
        {hiddenColumns.has("key") ? null : header("key", t("colKey"))}
        {showWaveforms ? plainHeader("wave", t("colWaveform")) : null}
        {hiddenColumns.has("tags") ? null : plainHeader("tags", t("colTags"))}
        <span aria-hidden />
      </div>

      <div className="sample-table-body" ref={scrollRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualItems.map((virtual) => {
            const sample = samples[virtual.index];
            if (!sample) return null;
            const selected = selectedIds.has(sample.id);
            const analyzing = analyzingIds.has(sample.id);
            const playing = playingId === sample.id;
            return (
              <div
                key={virtual.key}
                data-index={virtual.index}
                data-sample-id={sample.id}
                className={`sample-row${selected ? " selected" : ""}${sample.missing ? " missing" : ""}`}
                style={{
                  gridTemplateColumns: template,
                  transform: `translateY(${String(virtual.start)}px)`,
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
                  className={`col fav${playing ? " playing" : ""}`}
                  tabIndex={-1}
                  aria-label={sample.favorite ? tc("ctxUnfavorite") : tc("ctxFavorite")}
                  aria-pressed={sample.favorite}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(sample.id, !sample.favorite);
                  }}
                >
                  <PlayIcon size={11} weight="fill" className="fav-play" aria-hidden />
                  <StarIcon
                    size={11}
                    weight={sample.favorite ? "fill" : "regular"}
                    className="fav-star"
                  />
                </button>

                <div className="col name" title={sample.path}>
                  {sample.missing ? (
                    <WarningCircleIcon size={11} weight="fill" className="row-missing-icon" />
                  ) : null}
                  {(() => {
                    const { base, ext } = splitFilename(sample.filename);
                    return (
                      <span className="name-text">
                        {highlight(base, highlightText)}
                        {ext ? <span className="name-ext">{ext}</span> : null}
                      </span>
                    );
                  })()}
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
                      colored={coloredWaveforms}
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
                <span aria-hidden />
              </div>
            );
          })}

          {loading && samples.length === 0 ? (
            <div className="sample-table-empty" role="status" aria-live="polite">
              <div className="sample-table-loading">
                <CircleNotchIcon size={28} className="sample-table-spin" aria-hidden />
                <div className="sample-table-empty-title">{t("loadingSamples")}</div>
              </div>
            </div>
          ) : null}

          {!loading && samples.length === 0 ? (
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
