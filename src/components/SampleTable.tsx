import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CaretDownIcon,
  CaretUpIcon,
  CircleNotchIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import type { OptionalColumn } from "../lib/omni";
import { isProfileOn, profileMark, useRenderTiming } from "../lib/profile";

/** Exposed so LibraryView can keep arrow-key selection on screen. */
export interface SampleTableScrollApi {
  scrollToIndex: (index: number) => void;
}
import { peaksQueueSnapshot, requestVisible } from "../lib/rowPeaks";
import { assignSlots, emptySlots, type SlotState } from "../lib/rowSlots";
import { useStableCallback } from "../lib/useStableCallback";
import { SampleRowView, type SampleRowHandlers } from "./SampleRowView";

const ROW_HEIGHT = 28;
/**
 * Extra rows above/below the viewport so a normal flick does not outrun the
 * rendered rows. Paints are ~1 ms now, so a larger window is cheap.
 */
const ROW_OVERSCAN = 40;
/** Fetch peaks this many rows past the mounted window. */
const PEAK_PREFETCH_PAD = 12;
/** Matches `.sample-row .col.wave { padding: 0 14px 0 2px }`. */
const WAVE_PAD_X = 16;
const DEFAULT_WAVE_WIDTH = 120;
/** Movement past this (css px) turns a header press into a column reorder. */
const REORDER_THRESHOLD_PX = 5;

const SORTABLE = new Set<ResizableColumn>(["name", "type", "bpm", "key"]);

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
  showWaveforms: boolean;
  coloredWaveforms: boolean;
  hiddenColumns: Set<OptionalColumn>;
  columnWidths: ColumnWidths;
  columnOrder: ResizableColumn[];
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  highlightText: string;
  hoverPreviewHeld: boolean;
  /** Imperative scroll API for arrow-key selection (virtualizer.scrollToIndex). */
  scrollApiRef?: RefObject<SampleTableScrollApi | null>;
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

export const SampleTable = memo(function SampleTable({
  samples,
  indexedCount,
  loading = false,
  selectedIds,
  playingId,
  showWaveforms,
  coloredWaveforms,
  hiddenColumns,
  columnWidths,
  columnOrder,
  sortColumn,
  sortDirection,
  highlightText,
  hoverPreviewHeld,
  scrollApiRef,
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
  useRenderTiming("SampleTable");
  const tableRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollAt = useRef(0);
  const lastScrollTop = useRef(0);
  const lastRangeKey = useRef("");
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

  useEffect(() => {
    if (!scrollApiRef) return;
    scrollApiRef.current = {
      scrollToIndex: (index: number) => {
        virtualizer.scrollToIndex(index, { align: "auto" });
      },
    };
    return () => {
      scrollApiRef.current = null;
    };
  }, [scrollApiRef, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const rangeStart = virtualItems[0]?.index ?? 0;
  const rangeEnd = virtualItems.at(-1)?.index ?? -1;

  /* Pixel span covered by the rows of the last render (for fe.void_scroll). */
  const renderedSpan = useRef({ start: 0, end: 0 });
  useLayoutEffect(() => {
    renderedSpan.current = {
      start: virtualItems[0]?.start ?? 0,
      end: virtualItems.at(-1)?.end ?? 0,
    };
  });

  /* Profile scroll / void marks. Full rows always (lite mode delayed tags and
   * felt like pop-in). */
  const profileDetail = useRef("");
  profileDetail.current = `n=${String(samples.length)} waves=${String(showWaveforms)}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    let lastAt = performance.now();
    const onScroll = () => {
      if (!isProfileOn()) return;
      const now = performance.now();
      /* Rubber-band overscroll can be negative; voids use clamped top. */
      const top = Math.max(0, el.scrollTop);
      const rawTop = el.scrollTop;
      const dt = now - lastAt;
      const dy = rawTop - lastTop;
      lastAt = now;
      lastTop = rawTop;
      const speed = Math.abs(dy) / Math.max(1, dt);
      lastScrollAt.current = now;
      lastScrollTop.current = top;
      const span = renderedSpan.current;
      const bottom = top + el.clientHeight;
      const gap = Math.max(0, span.start - top) + Math.max(0, bottom - span.end);
      const q = peaksQueueSnapshot();
      profileMark(
        "fe.scroll",
        dt,
        `top=${top.toFixed(0)} dy=${dy.toFixed(0)} speed=${speed.toFixed(2)} gap=${gap.toFixed(0)} ${profileDetail.current} q_active=${String(q.active)} q_wait=${String(q.queued)}`,
      );
      if (gap > 0) {
        profileMark("fe.void_scroll", gap, `px top=${top.toFixed(0)} speed=${speed.toFixed(2)}`);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  useLayoutEffect(() => {
    if (!isProfileOn()) return;
    const key = `${String(rangeStart)}:${String(rangeEnd)}:${String(virtualItems.length)}`;
    if (key === lastRangeKey.current) return;
    lastRangeKey.current = key;
    const sinceScroll =
      lastScrollAt.current > 0 ? performance.now() - lastScrollAt.current : -1;
    const q = peaksQueueSnapshot();
    profileMark(
      "fe.virt_range",
      sinceScroll < 0 ? 0 : sinceScroll,
      `range=${String(rangeStart)}-${String(rangeEnd)} mounted=${String(virtualItems.length)} total_h=${String(virtualizer.getTotalSize())} n=${String(samples.length)} since_scroll_ms=${sinceScroll.toFixed(1)} q_wait=${String(q.queued)}`,
    );
  }, [rangeStart, rangeEnd, samples.length, virtualItems.length, virtualizer]);

  /* fe.void (profile builds): after each render, how many px of the visible
   * area have no rendered rows. Measures the "void" while scrolling. */
  useLayoutEffect(() => {
    if (!isProfileOn()) return;
    const el = scrollRef.current;
    const first = virtualItems[0];
    const last = virtualItems.at(-1);
    if (!el || !first || !last) return;
    const top = Math.max(0, el.scrollTop);
    const bottom = top + el.clientHeight;
    const gap = Math.max(0, first.start - top) + Math.max(0, bottom - last.end);
    if (gap > 0) {
      profileMark(
        "fe.void",
        gap,
        `px top=${top.toFixed(0)} view_h=${String(el.clientHeight)} rows=${String(first.start)}-${String(last.end)} range=${String(first.index)}-${String(last.index)}`,
      );
    }
  });

  /* Fetch peaks for the mounted window, also while scrolling. Each call
   * replaces the queue, so rows that scrolled past are dropped; a fetch is a
   * ~4 ms peakfile read off the main thread, so a flick wastes little. */
  useEffect(() => {
    if (!showWaveforms || samples.length === 0 || rangeEnd < rangeStart) return;
    const from = Math.max(0, rangeStart - PEAK_PREFETCH_PAD);
    const to = Math.min(samples.length - 1, rangeEnd + PEAK_PREFETCH_PAD);
    const ids: number[] = [];
    for (let index = from; index <= to; index++) {
      const sample = samples[index];
      if (sample && !sample.missing && sample.availability === "local") ids.push(sample.id);
    }
    requestVisible(ids);
  }, [showWaveforms, samples, rangeStart, rangeEnd]);

  /* One width measurement for every row canvas (rows never read layout). */
  const [waveWidth, setWaveWidth] = useState(DEFAULT_WAVE_WIDTH);
  useEffect(() => {
    const header = headerRef.current?.querySelector<HTMLElement>('[data-col="wave"]');
    if (!header) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = Math.max(40, Math.round(entry.contentRect.width - WAVE_PAD_X));
      setWaveWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
    };
  }, [showWaveforms, orderKey]);

  /* Recycle row DOM (and canvases) as rows scroll: see rowSlots.ts. */
  const slotsRef = useRef<SlotState>(emptySlots());
  const slots = assignSlots(
    slotsRef.current,
    virtualItems.map((v) => v.index),
  );
  slotsRef.current = slots;

  /* Stable handlers so memoized rows skip re-rendering. */
  const handleSelect = useStableCallback((sample: SampleRow, e: React.MouseEvent) => {
    onSelect(sample.id, e);
  });
  const handleToggleFavorite = useStableCallback((id: number, favorite: boolean) => {
    onToggleFavorite(id, favorite);
  });
  const handleOpenMenu = useStableCallback((sample: SampleRow, e: React.MouseEvent) => {
    e.preventDefault();
    if (!selectedIds.has(sample.id)) onSelect(sample.id, e);
    onOpenMenu(e.clientX, e.clientY, sample);
  });
  const handleDragStart = useStableCallback((sample: SampleRow, e: React.DragEvent) => {
    if (sample.missing) {
      e.preventDefault();
      return;
    }
    if (!selectedIds.has(sample.id)) onSelect(sample.id, e);
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", sample.path);
    onDragSelected();
  });
  const handleHover = useStableCallback((sample: SampleRow) => {
    if (hoverPreviewHeld && !sample.missing && sample.availability === "local") {
      onHoverPreview(sample.id);
    }
  });
  const handleScrub = useStableCallback((sample: SampleRow, fraction: number) => {
    onScrubRow(sample, fraction);
  });
  const rowHandlers = useMemo<SampleRowHandlers>(
    () => ({
      onSelect: handleSelect,
      onToggleFavorite: handleToggleFavorite,
      onOpenMenu: handleOpenMenu,
      onDragStart: handleDragStart,
      onHover: handleHover,
      onScrub: handleScrub,
    }),
    [handleSelect, handleToggleFavorite, handleOpenMenu, handleDragStart, handleHover, handleScrub],
  );

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
    /* Measure the rendered track width. Stored values are fr weights, not px. */
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
        {/* Row lines are the container's background, so an area the browser has
          * scrolled to before React renders its rows (fast flicks, scrollbar
          * yanks) looks like empty rows for a frame instead of a void. */}
        <div
          className={samples.length > 0 ? "sample-table-rows" : undefined}
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualItems.map((virtual) => {
            const sample = samples[virtual.index];
            if (!sample) return null;
            return (
              <SampleRowView
                key={slots.byIndex.get(virtual.index) ?? virtual.index}
                sample={sample}
                index={virtual.index}
                top={virtual.start}
                template={template}
                columns={columns}
                selected={selectedIds.has(sample.id)}
                playing={playingId === sample.id}
                colored={coloredWaveforms}
                highlightText={highlightText}
                waveWidth={waveWidth}
                handlers={rowHandlers}
              />
            );
          })}
        </div>

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
  );
});
