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
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  clampColumnWidth,
  columnGridTemplate,
  type ColumnWidths,
  type ResizableColumn,
} from "../lib/columnWidths";
import {
  dropIndexFromClientX,
  mergeColumnOrder,
  reorderByVisibleDrop,
  visibleOrderedColumns,
} from "../lib/columnOrder";
import {
  measureAllColLefts,
  measureColRects,
  playColumnFlip,
} from "../lib/flipColumns";
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
/** Movement past this (css px) turns a header press into a column reorder. */
const REORDER_THRESHOLD_PX = 5;

const SORTABLE = new Set<ResizableColumn>(["name", "type", "bpm", "key"]);

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

function ordersEqual(a: readonly ResizableColumn[], b: readonly ResizableColumn[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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
  columnOrder: ResizableColumn[];
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  highlightText: string;
  hoverPreviewHeld: boolean;
  onSelect: (id: number, e: React.MouseEvent) => void;
  onHoverPreview: (id: number) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
  onSort: (column: SortColumn) => void;
  onColumnWidthsChange: (widths: ColumnWidths) => void;
  onColumnOrderChange: (order: ResizableColumn[]) => void;
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
  columnOrder,
  sortColumn,
  sortDirection,
  highlightText,
  hoverPreviewHeld,
  onSelect,
  onHoverPreview,
  onToggleFavorite,
  onSort,
  onColumnWidthsChange,
  onColumnOrderChange,
  onOpenMenu,
  onDragSelected,
  onScrubRow,
}: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");
  const tableRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    column: ResizableColumn;
    startX: number;
    startWidth: number;
  } | null>(null);
  const reorderRef = useRef<{
    column: ResizableColumn;
    startX: number;
    active: boolean;
    sortable: boolean;
  } | null>(null);
  const widthsRef = useRef(columnWidths);
  widthsRef.current = columnWidths;
  const orderRef = useRef(columnOrder);
  orderRef.current = columnOrder;
  const flipBeforeRef = useRef<Map<HTMLElement, number> | null>(null);

  const [draftOrder, setDraftOrder] = useState<ResizableColumn[] | null>(null);
  const draftOrderRef = useRef<ResizableColumn[] | null>(null);
  draftOrderRef.current = draftOrder;
  const effectiveOrder = draftOrder ?? mergeColumnOrder(columnOrder);
  const columns = visibleOrderedColumns(effectiveOrder, hiddenColumns, showWaveforms);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const orderKey = effectiveOrder.join(",");

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

  useLayoutEffect(() => {
    const root = tableRef.current;
    const before = flipBeforeRef.current;
    if (!root || !before) return;
    flipBeforeRef.current = null;
    playColumnFlip(root, before);
  }, [orderKey]);

  /* Clear draft once the parent has caught up with the committed order. */
  useEffect(() => {
    if (draftOrder && ordersEqual(draftOrder, mergeColumnOrder(columnOrder))) {
      setDraftOrder(null);
    }
  }, [columnOrder, draftOrder]);

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

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const session = reorderRef.current;
      if (!session) return;
      const dx = e.clientX - session.startX;
      if (!session.active) {
        if (Math.abs(dx) < REORDER_THRESHOLD_PX) return;
        session.active = true;
        document.body.classList.add("col-reordering");
      }

      const header = headerRef.current;
      const table = tableRef.current;
      if (!header || !table) return;

      const visible = columnsRef.current;
      const rects = measureColRects(header);
      const drop = dropIndexFromClientX(visible, session.column, e.clientX, rects);
      const current = draftOrderRef.current ?? mergeColumnOrder(orderRef.current);
      const next = reorderByVisibleDrop(current, visible, session.column, drop);
      if (ordersEqual(next, current)) return;

      flipBeforeRef.current = measureAllColLefts(table);
      draftOrderRef.current = next;
      setDraftOrder(next);
    };

    const onUp = () => {
      const session = reorderRef.current;
      reorderRef.current = null;
      document.body.classList.remove("col-reordering");
      if (!session) return;

      if (!session.active) {
        if (session.sortable && SORTABLE.has(session.column)) {
          onSort(session.column as SortColumn);
        }
        return;
      }

      const committed = draftOrderRef.current ?? mergeColumnOrder(orderRef.current);
      if (!ordersEqual(committed, mergeColumnOrder(orderRef.current))) {
        onColumnOrderChange(committed);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onColumnOrderChange, onSort]);

  const template = columnGridTemplate(columns, columnWidths);

  const startResize = (column: ResizableColumn, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    /* Measure the rendered track width — stored values are fr weights, not px. */
    const header = headerRef.current?.querySelector<HTMLElement>(`[data-col="${column}"]`);
    const rendered = header?.getBoundingClientRect().width;
    dragRef.current = {
      column,
      startX: e.clientX,
      startWidth: rendered != null && rendered > 0 ? rendered : widthsRef.current[column],
    };
    document.body.classList.add("col-resizing");
  };

  const startReorder = (column: ResizableColumn, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    reorderRef.current = {
      column,
      startX: e.clientX,
      active: false,
      sortable: SORTABLE.has(column),
    };
  };

  const columnLabel = (column: ResizableColumn): string => {
    switch (column) {
      case "name":
        return t("colName");
      case "type":
        return t("colType");
      case "bpm":
        return t("colBpm");
      case "key":
        return t("colKey");
      case "wave":
        return t("colWaveform");
      case "tags":
        return t("colTags");
    }
  };

  const renderHeader = (column: ResizableColumn) => {
    const label = columnLabel(column);
    const sortable = SORTABLE.has(column);
    const active = sortable && sortColumn === column;
    return (
      <div key={column} className="col-header" data-col={column}>
        {sortable ? (
          <button
            type="button"
            className="col"
            aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
            onPointerDown={(e) => {
              startReorder(column, e);
            }}
            onClick={(e) => {
              /* Sort is handled on pointerup so drag can suppress it. */
              e.preventDefault();
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
        ) : (
          <span
            className="col"
            onPointerDown={(e) => {
              startReorder(column, e);
            }}
          >
            {label}
          </span>
        )}
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

  const renderCell = (column: ResizableColumn, sample: SampleRow, analyzing: boolean, playing: boolean) => {
    switch (column) {
      case "name": {
        const { base, ext } = splitFilename(sample.filename);
        return (
          <div key={column} className="col name" data-col={column} title={sample.path}>
            {sample.missing ? (
              <WarningCircleIcon size={11} weight="fill" className="row-missing-icon" />
            ) : null}
            <span className="name-text">
              {highlight(base, highlightText)}
              {ext ? <span className="name-ext">{ext}</span> : null}
            </span>
          </div>
        );
      }
      case "type":
        return (
          <div key={column} className="col type" data-col={column}>
            {sample.missing ? "" : (sample.sample_type ?? "")}
          </div>
        );
      case "bpm":
        return (
          <div key={column} className="col mono-cell" data-col={column}>
            {sample.bpm == null ? EM_DASH : Math.round(sample.bpm)}
          </div>
        );
      case "key":
        return (
          <div key={column} className="col mono-cell" data-col={column}>
            {sample.key_name ?? EM_DASH}
          </div>
        );
      case "wave":
        return (
          <div key={column} className="col wave" data-col={column}>
            <RowWaveform
              sampleId={sample.id}
              missing={sample.missing}
              analyzing={analyzing}
              selected={selectedIds.has(sample.id)}
              colored={coloredWaveforms}
              progress={playing ? playingProgress : null}
              onScrub={(fraction) => {
                onScrubRow(sample, fraction);
              }}
            />
          </div>
        );
      case "tags":
        return (
          <div key={column} className="col tags" data-col={column}>
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
        );
    }
  };

  return (
    <div className="sample-table" ref={tableRef}>
      <div
        className="sample-table-header"
        ref={headerRef}
        style={{ gridTemplateColumns: template }}
      >
        <span />
        {columns.map((column) => renderHeader(column))}
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

                {columns.map((column) => renderCell(column, sample, analyzing, playing))}
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
