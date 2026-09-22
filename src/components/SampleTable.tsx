import { useVirtualizer } from "@tanstack/react-virtual";
import { StarIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RowWaveform } from "./RowWaveform";

export interface TagChip { path: string; color: string | null }
export interface SampleRow {
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
}

type SortCol = "name" | "type" | "bpm" | "key" | "created_at" | "favorite";

export type ContextAction =
  | "open"
  | "favorite"
  | "reveal"
  | "copyPath"
  | "copyFilename"
  | "reanalyze"
  | "showParent"
  | "removeMissing";

interface Props {
  samples: SampleRow[];
  selectedIds: Set<number>;
  focusedId: number | null;
  analyzingIds: Set<number>;
  showWaveforms: boolean;
  sortColumn: SortCol;
  sortDirection: "asc" | "desc" | "clear";
  highlightText?: string;
  onSelect: (id: number, e: React.MouseEvent) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
  onSort: (col: SortCol) => void;
  onContextAction: (action: ContextAction, sample: SampleRow) => void;
}

function highlightName(name: string, query: string | undefined) {
  if (!query?.trim()) return name;
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

interface MenuState { x: number; y: number; sample: SampleRow }

export function SampleTable({
  samples,
  selectedIds,
  focusedId,
  analyzingIds,
  showWaveforms,
  sortColumn,
  sortDirection,
  highlightText,
  onSelect,
  onToggleFavorite,
  onSort,
  onContextAction,
}: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");
  const parentRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: samples.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  useEffect(() => {
    if (!menu) return;
    const close = () => void setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const run = (action: ContextAction) => {
    if (!menu) return;
    onContextAction(action, menu.sample);
    setMenu(null);
  };

  return (
    <div className="sample-table">
      <div className="sample-table-header">
        <button type="button" className="col fav" onClick={() => void onSort("favorite")}>
          {sortMark(sortColumn === "favorite", sortDirection)}
        </button>
        <button type="button" className="col name" onClick={() => void onSort("name")}>
          {t("colName")}
          {sortMark(sortColumn === "name", sortDirection)}
        </button>
        <button type="button" className="col type" onClick={() => void onSort("type")}>
          {t("colType")}
          {sortMark(sortColumn === "type", sortDirection)}
        </button>
        <button type="button" className="col bpm" onClick={() => void onSort("bpm")}>
          {t("colBpm")}
          {sortMark(sortColumn === "bpm", sortDirection)}
        </button>
        <button type="button" className="col key" onClick={() => void onSort("key")}>
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
            if (!sample) return null;
            const selected = selectedIds.has(sample.id);
            const focused = focusedId === sample.id;
            const analyzing = analyzingIds.has(sample.id);
            return (
              <div
                key={sample.id}
                className={`sample-row${selected ? " selected" : ""}${focused ? " focused" : ""}${sample.missing ? " missing" : ""}${analyzing ? " analyzing" : ""}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: virt.size,
                  transform: `translateY(${virt.start}px)`,
                }}
                onClick={(e) => void onSelect(sample.id, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selectedIds.has(sample.id)) {
                    onSelect(sample.id, e);
                  }
                  setMenu({ x: e.clientX, y: e.clientY, sample });
                }}
              >
                <button
                  type="button"
                  className="col fav"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(sample.id, !sample.favorite);
                  }}
                >
                  <StarIcon size={12} weight={sample.favorite ? "fill" : "regular"} />
                </button>
                <div className="col name" title={sample.path}>
                  {sample.missing ? (
                    <WarningCircleIcon size={11} weight="fill" className="missing-icon" />
                  ) : null}
                  <span className="name-text">
                    {highlightName(sample.filename, highlightText)}
                  </span>
                </div>
                <div className="col type">{sample.sample_type ?? ""}</div>
                <div className="col bpm">{sample.bpm != null ? Math.round(sample.bpm) : ""}</div>
                <div className="col key">{sample.key_name ?? ""}</div>
                <div className="col wave">
                  <RowWaveform
                    sampleId={sample.id}
                    missing={sample.missing}
                    analyzing={analyzing}
                    showWaveform={showWaveforms}
                  />
                </div>
                <div className="col tags">
                  {analyzing ? (
                    <span className="analyzing-label">{tc("statusAnalyzing")}</span>
                  ) : (
                    sample.tags.map((tag) => (
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
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {menu ? (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => void e.stopPropagation()}
        >
          <button type="button" onClick={() => void run("open")} disabled={menu.sample.missing}>
            {tc("ctxOpen")}
          </button>
          <button type="button" onClick={() => void run("favorite")}>
            {menu.sample.favorite ? tc("ctxUnfavorite") : tc("ctxFavorite")}
          </button>
          <button type="button" onClick={() => void run("reveal")} disabled={menu.sample.missing}>
            {tc("ctxReveal")}
          </button>
          <button type="button" onClick={() => void run("copyPath")}>
            {tc("ctxCopyPath")}
          </button>
          <button type="button" onClick={() => void run("copyFilename")}>
            {tc("ctxCopyFilename")}
          </button>
          <button type="button" onClick={() => void run("reanalyze")} disabled={menu.sample.missing}>
            {tc("ctxReanalyze")}
          </button>
          <button type="button" onClick={() => void run("showParent")}>
            {tc("ctxShowParent")}
          </button>
          {menu.sample.missing ? (
            <button type="button" className="danger" onClick={() => void run("removeMissing")}>
              {tc("ctxRemoveMissing")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
