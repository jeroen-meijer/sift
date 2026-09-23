import { WarningCircleIcon } from "@phosphor-icons/react";
import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ResizableColumn } from "../lib/columnWidths";
import type { SampleRow } from "../lib/ipc";
import { analysisStore } from "../lib/liveStores";
import { highlightRanges } from "../lib/searchHighlight";
import { useStoreSelector } from "../lib/store";
import { tagPalette } from "../lib/tagColors";
import { RowPlayIcon, RowStarIcon } from "./RowIcons";
import { RowWaveform } from "./RowWaveform";

const EM_DASH = "—";

function highlight(name: string, query: string): ReactNode {
  const ranges = highlightRanges(name, query);
  if (ranges.length === 0) return name;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(name.slice(at, start));
    parts.push(<mark key={start}>{name.slice(start, end)}</mark>);
    at = end;
  }
  if (at < name.length) parts.push(name.slice(at));
  return <>{parts}</>;
}

/** Split `kick.wav` so the extension can sit in a quieter span. */
function splitFilename(filename: string): { base: string; ext: string } {
  const at = filename.lastIndexOf(".");
  if (at <= 0 || at === filename.length - 1) return { base: filename, ext: "" };
  return { base: filename.slice(0, at), ext: filename.slice(at) };
}

export interface SampleRowHandlers {
  onSelect: (sample: SampleRow, e: React.MouseEvent) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
  onOpenMenu: (sample: SampleRow, e: React.MouseEvent) => void;
  onDragStart: (sample: SampleRow, e: React.DragEvent) => void;
  onHover: (sample: SampleRow) => void;
  onScrub: (sample: SampleRow, fraction: number) => void;
}

interface Props {
  sample: SampleRow;
  index: number;
  /** `virtual.start` from the virtualizer. */
  top: number;
  template: string;
  columns: readonly ResizableColumn[];
  selected: boolean;
  playing: boolean;
  colored: boolean;
  highlightText: string;
  /** Row waveform canvas width in CSS px. */
  waveWidth: number;
  handlers: SampleRowHandlers;
}

/**
 * One table row. Memoized: a row re-renders only when its own sample, its
 * selected/playing flags, or its analyzing flag (from `analysisStore`) change.
 */
export const SampleRowView = memo(function SampleRowView({
  sample,
  index,
  top,
  template,
  columns,
  selected,
  playing,
  colored,
  highlightText,
  waveWidth,
  handlers,
}: Props) {
  const { t } = useTranslation("common");
  const analyzing = useStoreSelector(analysisStore, (s) => s.activeIds.has(sample.id));

  const renderCell = (column: ResizableColumn) => {
    switch (column) {
      case "name": {
        const { base, ext } = splitFilename(sample.filename);
        return (
          <div key={column} className="col name" data-col={column} title={sample.path}>
            {sample.missing ? (
              <WarningCircleIcon size={11} weight="fill" className="row-missing-icon" />
            ) : sample.availability === "cloud" ? (
              <span className="row-cloud-badge" title={t("statusOnlineOnly")}>
                {t("statusOnlineOnly")}
              </span>
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
              availability={sample.availability}
              analyzing={analyzing}
              selected={selected}
              colored={colored}
              playing={playing}
              durationMs={sample.duration_ms ?? 0}
              width={waveWidth}
              onScrub={(fraction) => {
                handlers.onScrub(sample, fraction);
              }}
            />
          </div>
        );
      case "tags":
        return (
          <div key={column} className="col tags" data-col={column}>
            {analyzing ? (
              <span className="analyzing-label">{t("statusAnalyzing")}</span>
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
    <div
      data-index={index}
      data-sample-id={sample.id}
      className={`sample-row${selected ? " selected" : ""}${sample.missing ? " missing" : ""}`}
      style={{
        gridTemplateColumns: template,
        transform: `translateY(${String(top)}px)`,
      }}
      draggable={!sample.missing}
      onDragStart={(e) => {
        handlers.onDragStart(sample, e);
      }}
      onClick={(e) => {
        handlers.onSelect(sample, e);
      }}
      onMouseEnter={() => {
        handlers.onHover(sample);
      }}
      onContextMenu={(e) => {
        handlers.onOpenMenu(sample, e);
      }}
    >
      <button
        type="button"
        className={`col fav${playing ? " playing" : ""}`}
        tabIndex={-1}
        aria-label={sample.favorite ? t("ctxUnfavorite") : t("ctxFavorite")}
        aria-pressed={sample.favorite}
        onClick={(e) => {
          e.stopPropagation();
          handlers.onToggleFavorite(sample.id, !sample.favorite);
        }}
      >
        <RowPlayIcon size={11} className="fav-play" />
        <RowStarIcon size={11} filled={sample.favorite} className="fav-star" />
      </button>

      {columns.map((column) => renderCell(column))}
      <span aria-hidden />
    </div>
  );
});
