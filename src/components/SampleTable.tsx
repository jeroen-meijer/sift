import { useVirtualizer } from "@tanstack/react-virtual";
import { Star } from "@phosphor-icons/react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

export type TagChip = { path: string; color: string | null };
export type SampleRow = {
  id: number;
  root_id: number;
  path: string;
  filename: string;
  parent_path: string;
  extension: string;
  missing: boolean;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  duration_ms: number | null;
  format: string | null;
  bpm: number | null;
  key_name: string | null;
  sample_type: string | null;
  favorite: boolean;
  tags: TagChip[];
};

type SortCol = "name" | "type" | "bpm" | "key" | "created_at" | "favorite";

type Props = {
  samples: SampleRow[];
  selectedIds: Set<number>;
  focusedId: number | null;
  sortColumn: SortCol;
  sortDirection: "asc" | "desc" | "clear";
  highlightText?: string;
  onSelect: (id: number, e: React.MouseEvent) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
  onSort: (col: SortCol) => void;
};

function highlightName(name: string, query: string | undefined) {
  if (!query || !query.trim()) return name;
  const q = query.trim();
  const lower = name.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark>{name.slice(idx, idx + q.length)}</mark>
      {name.slice(idx + q.length)}
    </>
  );
}

function sortMark(active: boolean, dir: "asc" | "desc" | "clear") {
  if (!active || dir === "clear") return "";
  return dir === "asc" ? " ↓" : " ↑";
}

export function SampleTable({
  samples,
  selectedIds,
  focusedId,
  sortColumn,
  sortDirection,
  highlightText,
  onSelect,
  onToggleFavorite,
  onSort,
}: Props) {
  const { t } = useTranslation("library");
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: samples.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  return (
    <div className="sample-table">
      <div className="sample-table-header">
        <button type="button" className="col fav" onClick={() => onSort("favorite")}>
          {sortMark(sortColumn === "favorite", sortDirection)}
        </button>
        <button type="button" className="col name" onClick={() => onSort("name")}>
          {t("colName")}
          {sortMark(sortColumn === "name", sortDirection)}
        </button>
        <button type="button" className="col type" onClick={() => onSort("type")}>
          {t("colType")}
          {sortMark(sortColumn === "type", sortDirection)}
        </button>
        <button type="button" className="col bpm" onClick={() => onSort("bpm")}>
          {t("colBpm")}
          {sortMark(sortColumn === "bpm", sortDirection)}
        </button>
        <button type="button" className="col key" onClick={() => onSort("key")}>
          {t("colKey")}
          {sortMark(sortColumn === "key", sortDirection)}
        </button>
        <div className="col wave">{t("colWaveform")}</div>
        <div className="col tags">{t("colTags")}</div>
      </div>
      <div className="sample-table-body" ref={parentRef}>
        <div
          style={{
            height: rowVirtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virt) => {
            const sample = samples[virt.index];
            const selected = selectedIds.has(sample.id);
            const focused = focusedId === sample.id;
            return (
              <div
                key={sample.id}
                className={`sample-row${selected ? " selected" : ""}${focused ? " focused" : ""}${sample.missing ? " missing" : ""}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virt.size,
                  transform: `translateY(${virt.start}px)`,
                }}
                onClick={(e) => onSelect(sample.id, e)}
              >
                <button
                  type="button"
                  className="col fav"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(sample.id, !sample.favorite);
                  }}
                >
                  <Star size={12} weight={sample.favorite ? "fill" : "regular"} />
                </button>
                <div className="col name" title={sample.path}>
                  {highlightName(sample.filename, highlightText)}
                </div>
                <div className="col type">{sample.sample_type ?? ""}</div>
                <div className="col bpm">{sample.bpm != null ? Math.round(sample.bpm) : ""}</div>
                <div className="col key">{sample.key_name ?? ""}</div>
                <div className="col wave wave-placeholder" />
                <div className="col tags">
                  {sample.tags.map((tag) => (
                    <span
                      key={tag.path}
                      className="tag-chip"
                      style={{
                        background: tag.color ? `${tag.color}33` : undefined,
                        borderColor: tag.color ?? undefined,
                      }}
                    >
                      {tag.path}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
