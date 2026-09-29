import { CheckSquareIcon, MinusSquareIcon, SquareIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { flattenTags, type TagNode } from "../../lib/ipc";
import { tagPalette } from "../../lib/tagColors";
import { OmniEditorChrome } from "./OmniEditorChrome";

export interface TagEditorValue {
  include: string[];
  exclude: string[];
}

interface Props {
  value: TagEditorValue;
  tags: TagNode[];
  /** Remaining sample count if this tag were added (path → count). */
  tagCounts: Map<string, number>;
  onChange: (next: TagEditorValue) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

interface Row {
  path: string;
  name: string;
  depth: number;
  color: string | null;
}

function matchesSegment(path: string, query: string): boolean {
  const q = query.toLowerCase();
  return path
    .toLowerCase()
    .split("/")
    .some((seg) => seg.startsWith(q));
}

export function TagEditor({
  value,
  tags,
  tagCounts,
  onChange,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(-1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const rows: Row[] = useMemo(() => {
    const flat = flattenTags(tags).map(({ node, depth }) => ({
      path: node.path,
      name: node.name,
      depth,
      color: node.color,
    }));
    if (!q.trim()) return flat;
    return flat
      .filter((r) => matchesSegment(r.path, q.trim()))
      .map((r) => ({ ...r, depth: 0 }));
  }, [tags, q]);

  useEffect(() => {
    setHi(q.trim() ? 0 : -1);
  }, [q, rows.length]);

  const syntax = [
    ...value.include.map((p) => `#${p.toLowerCase()}`),
    ...value.exclude.map((p) => `-#${p.toLowerCase()}`),
  ].join(" ");

  const toggle = (path: string, asExclude: boolean) => {
    if (asExclude) {
      const excluded = value.exclude.includes(path);
      onChange({
        include: value.include.filter((p) => p !== path),
        exclude: excluded
          ? value.exclude.filter((p) => p !== path)
          : [...value.exclude.filter((p) => p !== path), path],
      });
    } else {
      const included = value.include.includes(path);
      onChange({
        include: included
          ? value.include.filter((p) => p !== path)
          : [...value.include.filter((p) => p !== path), path],
        exclude: value.exclude.filter((p) => p !== path),
      });
    }
  };

  return (
    <OmniEditorChrome keysHint={t("omni.editor.tagKeys")} syntax={syntax || "#"}>
      <input
        ref={inputRef}
        className="omni-tag-search mono"
        spellCheck={false}
        placeholder={t("omni.editor.tagSearch")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((i) => Math.min(rows.length - 1, Math.max(0, i + 1)));
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((i) => Math.max(0, i - 1));
            return;
          }
          if (e.key === "Backspace" && q === "") {
            e.preventDefault();
            if (value.exclude.length > 0) {
              onChange({ ...value, exclude: value.exclude.slice(0, -1) });
            } else if (value.include.length > 0) {
              onChange({ ...value, include: value.include.slice(0, -1) });
            }
            return;
          }
          const highlighted = hi >= 0 ? rows[hi] : undefined;
          if (e.key === "Enter" && e.shiftKey && highlighted) {
            e.preventDefault();
            toggle(highlighted.path, true);
            setQ("");
            return;
          }
          if ((e.key === "Enter" || e.key === ",") && highlighted) {
            e.preventDefault();
            toggle(highlighted.path, false);
            setQ("");
            return;
          }
          if (e.key === "Enter" && !highlighted) {
            e.preventDefault();
            onConfirm();
            return;
          }
          if ((e.key === "Tab" || e.key === " ") && highlighted && q.trim()) {
            e.preventDefault();
            toggle(highlighted.path, false);
            onConfirm();
          }
        }}
      />
      <div className="omni-tag-list">
        {rows.map((row, i) => {
          const included = value.include.includes(row.path);
          const excluded = value.exclude.includes(row.path);
          const palette = tagPalette(row.path, row.color);
          const count = tagCounts.get(row.path) ?? 0;
          return (
            <div
              key={row.path}
              className={`omni-tag-row${i === hi ? " hi" : ""}`}
              onMouseEnter={() => {
                setHi(i);
              }}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onClick={() => {
                toggle(row.path, false);
                setQ("");
              }}
            >
              <span style={{ width: row.depth * 12 }} className="omni-tag-pad" />
              {excluded ? (
                <MinusSquareIcon size={14} weight="fill" className="omni-tag-check excl" />
              ) : included ? (
                <CheckSquareIcon size={14} weight="fill" className="omni-tag-check on" />
              ) : (
                <SquareIcon size={14} className="omni-tag-check" />
              )}
              <span className="omni-chip-dot" style={{ background: palette.dot }} />
              <span className="omni-tag-name">{q.trim() ? row.path : row.name}</span>
              <span className="omni-tag-count mono">{count}</span>
              {!excluded ? (
                <button
                  type="button"
                  className="omni-tag-not"
                  title={t("omni.editor.tagNot")}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(row.path, true);
                  }}
                >
                  not
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </OmniEditorChrome>
  );
}
