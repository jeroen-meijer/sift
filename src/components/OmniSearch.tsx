import {
  ColumnsIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  RepeatIcon,
  RowsIcon,
  StarIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { keys, matchesBinding } from "../lib/bindings";
import {
  chipKindsPresent,
  cloneOmniState,
  syncChipOrder,
  type ChipKind,
} from "../lib/chipOrder";
import type { FolderNode, TagNode } from "../lib/ipc";
import {
  EMPTY_OMNI,
  OPTIONAL_COLUMNS,
  folderChipLabel,
  omniHasBpm,
  omniHasQuery,
  omniHasTags,
  type OmniKey,
  type OmniState,
  type OptionalColumn,
  type SampleTypeFilter,
} from "../lib/omni";
import {
  pendingChipFromSession,
  triggerEditorMode,
  type OmniEditorSession,
} from "../lib/omniEditorSession";
import { formatOmniKey } from "../lib/omniKey";
import { SEARCH_INPUT_ATTRS } from "../lib/searchInputAttrs";
import {
  detectTrigger,
  loadRecentFilters,
  parseOmniQuery,
  pushRecentFilter,
  serializeOmniQuery,
  splitTrailingWord,
  triggerCompletions,
  type OmniTriggerKind,
} from "../lib/omniQuery";
import { tagPalette } from "../lib/tagColors";
import { Popover } from "../ui/Popover";
import { BpmEditor } from "./omni/BpmEditor";
import { KeyEditor } from "./omni/KeyEditor";
import { OmniChip } from "./omni/OmniChip";
import { OmniEditorAnchor } from "./omni/OmniEditorAnchor";
import { SuggestionDropdown, type SuggestionRow } from "./omni/SuggestionDropdown";
import { TagEditor } from "./omni/TagEditor";
import { TypeEditor } from "./omni/TypeEditor";

type EditorKind = OmniTriggerKind | null;

interface Props {
  value: OmniState;
  onChange: (next: OmniState) => void;
  folders: FolderNode[];
  tags: TagNode[];
  halfDouble: boolean;
  relativeKey: boolean;
  onToggleHalfDouble: () => void;
  onToggleRelativeKey: () => void;
  favoritesOnly: boolean;
  onToggleFavoritesOnly: () => void;
  hiddenColumns: Set<OptionalColumn>;
  onToggleColumn: (column: OptionalColumn) => void;
  columnLabels: Record<OptionalColumn, string>;
  /** Samples for facet counts (other filters on, the open editor's dimension left out). */
  facetBpms: number[];
  facetRootCounts: number[];
  facetTagCounts: Map<string, number>;
  onEditorKindChange: (kind: EditorKind) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const OmniSearch = memo(function OmniSearch({
  value,
  onChange,
  folders,
  tags,
  halfDouble,
  relativeKey,
  onToggleHalfDouble,
  onToggleRelativeKey,
  favoritesOnly,
  onToggleFavoritesOnly,
  hiddenColumns,
  onToggleColumn,
  columnLabels,
  facetBpms,
  facetRootCounts,
  facetTagCounts,
  onEditorKindChange,
  inputRef: externalInputRef,
}: Props) {
  const { t } = useTranslation("common");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [session, setSession] = useState<OmniEditorSession | null>(null);
  const [selectedChip, setSelectedChip] = useState<ChipKind | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestHi, setSuggestHi] = useState(0);
  const [recent, setRecent] = useState(loadRecentFilters);
  const [chipOrder, setChipOrder] = useState<ChipKind[]>(() =>
    syncChipOrder([], chipKindsPresent(value, null)),
  );
  const localInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? localInputRef;
  const fieldRef = useRef<HTMLDivElement>(null);
  const suppressSuggest = useRef(false);

  const editor = session?.kind ?? null;
  const pendingChip = pendingChipFromSession(session);
  const hasQuery = omniHasQuery(value);
  const roots = folders.filter((node) => node.is_root);

  const applyOmni = useCallback(
    (
      next: OmniState,
      opts?: { appendOrder?: readonly ChipKind[]; pending?: ChipKind | null },
    ) => {
      const pending = opts?.pending !== undefined ? opts.pending : pendingChip;
      setChipOrder((prev) =>
        syncChipOrder(prev, chipKindsPresent(next, pending), opts?.appendOrder),
      );
      onChange(next);
    },
    [onChange, pendingChip],
  );

  const closeSession = useCallback(
    (nextValue: OmniState = value) => {
      setSession(null);
      setChipOrder((prev) => syncChipOrder(prev, chipKindsPresent(nextValue, null)));
      onEditorKindChange(null);
      suppressSuggest.current = true;
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    },
    [inputRef, onEditorKindChange, value],
  );

  const openSession = useCallback(
    (
      kind: OmniTriggerKind,
      mode: OmniEditorSession["mode"],
      snapshot: OmniState = value,
    ) => {
      setSession({ kind, mode, snapshot: cloneOmniState(snapshot) });
      setSuggestOpen(false);
      setSelectedChip(null);
      onEditorKindChange(kind);
    },
    [onEditorKindChange, value],
  );

  const confirmEditor = useCallback(() => {
    const s = serializeOmniQuery(value);
    if (
      s &&
      (omniHasBpm(value) || value.key || omniHasTags(value) || value.sampleType !== "all")
    ) {
      setRecent(pushRecentFilter(s));
    }
    closeSession(value);
  }, [closeSession, value]);

  /** Open that chip's editor, or confirm if it is already open. */
  const toggleChipEditor = useCallback(
    (kind: Exclude<OmniTriggerKind, "type">) => {
      if (session?.kind === kind) {
        confirmEditor();
        return;
      }
      openSession(kind, "edit");
    },
    [confirmEditor, openSession, session?.kind],
  );

  const cancelEditor = useCallback(() => {
    if (!session) {
      closeSession();
      return;
    }
    const restored = session.snapshot;
    applyOmni(restored, { pending: null });
    closeSession(restored);
  }, [applyOmni, closeSession, session]);

  const fireTrigger = useCallback(
    (kind: OmniTriggerKind, textWithout: string) => {
      const snapshot = cloneOmniState(value);
      if (kind === "type") {
        const next =
          value.sampleType === "all"
            ? { ...value, text: textWithout, sampleType: "loop" as const }
            : { ...value, text: textWithout };
        applyOmni(next, { pending: null });
        openSession("type", value.sampleType === "all" ? "create" : "edit", snapshot);
        return;
      }
      const mode = triggerEditorMode(kind, value);
      const next = { ...value, text: textWithout };
      applyOmni(next, { pending: mode === "create" ? kind : null });
      openSession(kind, mode, snapshot);
    },
    [applyOmni, openSession, value],
  );

  const pickSuggestion = useCallback(
    (row: SuggestionRow) => {
      const { stem } = splitTrailingWord(value.text);
      if (row.kind === "trigger") {
        const without = value.text.trim() === "" ? "" : stem;
        fireTrigger(row.trigger, without);
        return;
      }
      if (row.kind === "recent") {
        const parsed = parseOmniQuery(row.recent, EMPTY_OMNI);
        applyOmni(parsed.state, { appendOrder: parsed.chipKinds, pending: null });
        setSuggestOpen(false);
        return;
      }
      const path = row.tagPath;
      const without = value.text.trim() === "" ? "" : stem;
      applyOmni({
        ...value,
        text: without,
        tagsInclude: value.tagsInclude.includes(path)
          ? value.tagsInclude
          : [...value.tagsInclude, path],
        tagsExclude: value.tagsExclude.filter((p) => p !== path),
      });
      setSuggestOpen(false);
    },
    [applyOmni, fireTrigger, value],
  );

  useEffect(() => {
    if (!session) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (fieldRef.current?.contains(target)) return;
      confirmEditor();
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", onPointerDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [session, confirmEditor]);

  /* Keep order in sync when LibraryView changes omni (sidebar, Find similar). */
  useEffect(() => {
    setChipOrder((prev) => syncChipOrder(prev, chipKindsPresent(value, pendingChip)));
  }, [value, pendingChip]);

  const removeChip = (kind: ChipKind) => {
    const next =
      kind === "folder"
        ? { ...value, folder: null }
        : kind === "tag"
          ? { ...value, tagsInclude: [], tagsExclude: [] }
          : kind === "bpm"
            ? { ...value, bpmMin: null, bpmMax: null }
            : { ...value, key: null };
    applyOmni(next, { pending: null });
    setSelectedChip(null);
    if (session?.kind === kind) closeSession(next);
  };

  const { word: lastWord } = splitTrailingWord(value.text);

  const suggestRows: SuggestionRow[] = useMemo(() => {
    if (session) return [];
    if (!value.text.trim()) {
      const rows: SuggestionRow[] = [
        { id: "tr-tag", kind: "trigger", label: t("omni.suggest.tag"), hint: "#", trigger: "tag" },
        { id: "tr-bpm", kind: "trigger", label: t("omni.suggest.bpm"), hint: "b:", trigger: "bpm" },
        { id: "tr-key", kind: "trigger", label: t("omni.suggest.key"), hint: "k:", trigger: "key" },
      ];
      for (const r of recent) {
        rows.push({ id: `recent:${r}`, kind: "recent", label: r, recent: r });
      }
      return rows;
    }
    const rows: SuggestionRow[] = [];
    for (const c of triggerCompletions(lastWord)) {
      rows.push({
        id: `tr-${c.kind}`,
        kind: "trigger",
        label: t(`omni.suggest.${c.kind}`),
        hint: c.insert,
        trigger: c.kind,
      });
    }
    if (lastWord.length >= 2) {
      const q = lastWord.toLowerCase();
      const flat = tags.flatMap(function walk(n: TagNode): TagNode[] {
        return [n, ...n.children.flatMap(walk)];
      });
      for (const tag of flat) {
        if (
          tag.path
            .toLowerCase()
            .split("/")
            .some((seg) => seg.startsWith(q))
        ) {
          rows.push({
            id: `tag:${tag.path}`,
            kind: "tag",
            label: t("omni.suggest.addTag", { path: tag.path }),
            tagPath: tag.path,
          });
          if (rows.filter((r) => r.kind === "tag").length >= 4) break;
        }
      }
    }
    return rows;
  }, [lastWord, recent, session, t, tags, value.text]);

  useEffect(() => {
    setSuggestHi(0);
  }, [suggestRows]);

  const tagParts: ReactNode[] = [];
  for (const path of value.tagsInclude) {
    if (tagParts.length) tagParts.push(<span key={`sep-${path}`} className="omni-tag-join">+</span>);
    tagParts.push(
      <span key={`in-${path}`} className="omni-tag-part">
        <span className="omni-chip-dot" style={{ background: tagPalette(path, null).dot }} />
        {path}
      </span>,
    );
  }
  for (const path of value.tagsExclude) {
    if (tagParts.length) tagParts.push(<span key={`sep-x-${path}`} className="omni-tag-join">+</span>);
    tagParts.push(
      <span key={`ex-${path}`} className="omni-tag-part excl">
        <span className="omni-tag-not-pre">{t("omni.chip.not")}</span>
        <span className="omni-chip-dot" style={{ background: tagPalette(path, null).dot }} />
        {path}
      </span>,
    );
  }
  if (pendingChip === "tag" && tagParts.length === 0) {
    tagParts.push(<span key="pend">…</span>);
  }

  const renderChip = (kind: ChipKind) => {
    if (kind === "folder") {
      if (value.folder == null) return null;
      return (
        <OmniChip
          key="folder"
          prefix={t("omni.chip.folder")}
          selected={selectedChip === "folder"}
          onSelect={() => {
            setSelectedChip("folder");
          }}
          removeLabel={t("action.clear")}
          onRemove={() => {
            removeChip("folder");
          }}
        >
          {folderChipLabel(value.folder, roots)}
        </OmniChip>
      );
    }
    if (kind === "tag") {
      return (
        <OmniChip
          key="tag"
          prefix={t("omni.chip.tag")}
          selected={selectedChip === "tag" || editor === "tag"}
          pending={pendingChip === "tag" && !omniHasTags(value)}
          onSelect={() => {
            toggleChipEditor("tag");
          }}
          removeLabel={t("action.clear")}
          onRemove={() => {
            removeChip("tag");
          }}
        >
          <span className="omni-tag-chip-inner">{tagParts}</span>
        </OmniChip>
      );
    }
    if (kind === "bpm") {
      return (
        <OmniChip
          key="bpm"
          prefix={t("omni.chip.bpm")}
          selected={selectedChip === "bpm" || editor === "bpm"}
          pending={pendingChip === "bpm" && !omniHasBpm(value)}
          toggle={{
            label: t("omni.halfDouble"),
            on: halfDouble,
            onToggle: onToggleHalfDouble,
          }}
          onSelect={() => {
            toggleChipEditor("bpm");
          }}
          removeLabel={t("action.clear")}
          onRemove={() => {
            removeChip("bpm");
          }}
        >
          {omniHasBpm(value)
            ? `${String(value.bpmMin ?? "…")}–${String(value.bpmMax ?? "…")}`
            : "…"}
        </OmniChip>
      );
    }
    return (
      <OmniChip
        key="key"
        prefix={t("omni.chip.key")}
        selected={selectedChip === "key" || editor === "key"}
        pending={pendingChip === "key" && value.key == null}
        toggle={
          value.key && value.key.mode !== "either"
            ? {
                label: t("omni.relative"),
                on: relativeKey,
                onToggle: onToggleRelativeKey,
              }
            : undefined
        }
        onSelect={() => {
          toggleChipEditor("key");
        }}
        removeLabel={t("action.clear")}
        onRemove={() => {
          removeChip("key");
        }}
      >
        {value.key ? formatOmniKey(value.key) : "…"}
      </OmniChip>
    );
  };

  return (
    <div className="omni-bar">
      <div
        ref={fieldRef}
        className="omni-field"
        onClick={() => {
          if (session) {
            confirmEditor();
            return;
          }
          inputRef.current?.focus();
        }}
      >
        <MagnifyingGlassIcon size={14} className="omni-icon" />
        <div className="omni-chips">
          {chipOrder.map(renderChip)}

          <input
            ref={inputRef}
            className="omni-input"
            value={value.text}
            placeholder={chipOrder.length > 0 ? "" : t("omni.placeholder")}
            {...SEARCH_INPUT_ATTRS}
            onFocus={() => {
              if (!suppressSuggest.current && !session) setSuggestOpen(true);
              suppressSuggest.current = false;
            }}
            onBlur={() => {
              window.setTimeout(() => {
                setSuggestOpen(false);
              }, 150);
            }}
            onChange={(e) => {
              const text = e.target.value;
              const trig = detectTrigger(text);
              if (trig) {
                fireTrigger(trig.kind, trig.textWithoutTrigger);
                return;
              }
              applyOmni({ ...value, text });
              setSelectedChip(null);
              if (!session) setSuggestOpen(true);
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text");
              if (!pasted.trim()) return;
              e.preventDefault();
              const parsed = parseOmniQuery(
                value.text ? `${value.text} ${pasted}` : pasted,
                value,
              );
              applyOmni(parsed.state, { appendOrder: parsed.chipKinds, pending: null });
              const s = serializeOmniQuery(parsed.state);
              if (s) setRecent(pushRecentFilter(s));
            }}
            onKeyDown={(e) => {
              if (session) return;

              if (suggestOpen && suggestRows.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSuggestHi((i) => Math.min(suggestRows.length - 1, i + 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSuggestHi((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === "Enter" && suggestHi >= 0) {
                  const picked = suggestRows[suggestHi];
                  if (picked) {
                    e.preventDefault();
                    pickSuggestion(picked);
                  }
                  return;
                }
                if (e.key === "Tab" && value.text.trim()) {
                  e.preventDefault();
                  const row = suggestRows[suggestHi] ?? suggestRows[0];
                  if (row) pickSuggestion(row);
                  return;
                }
              }

              if (e.key === "Enter") {
                e.preventDefault();
                const parsed = parseOmniQuery(value.text, { ...value, text: "" });
                applyOmni(parsed.state, { appendOrder: parsed.chipKinds, pending: null });
                const s = serializeOmniQuery(parsed.state);
                if (s) setRecent(pushRecentFilter(s));
                return;
              }

              if (e.key === "Escape") {
                setSelectedChip(null);
                setSuggestOpen(false);
                return;
              }

              const atStart =
                e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0;
              const empty = value.text === "";

              if (selectedChip) {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  const idx = chipOrder.indexOf(selectedChip);
                  if (idx > 0) setSelectedChip(chipOrder[idx - 1] ?? null);
                  return;
                }
                if (e.key === "ArrowRight") {
                  e.preventDefault();
                  const idx = chipOrder.indexOf(selectedChip);
                  if (idx < chipOrder.length - 1) setSelectedChip(chipOrder[idx + 1] ?? null);
                  else setSelectedChip(null);
                  return;
                }
                if (e.key === "Backspace" || e.key === "Delete") {
                  e.preventDefault();
                  removeChip(selectedChip);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (selectedChip !== "folder") openSession(selectedChip, "edit");
                  return;
                }
                if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
                  setSelectedChip(null);
                }
                return;
              }

              if ((atStart || empty) && e.key === "ArrowLeft" && chipOrder.length > 0) {
                e.preventDefault();
                setSelectedChip(chipOrder[chipOrder.length - 1] ?? null);
                return;
              }
              if (matchesBinding(e, keys.dropChip) && empty && chipOrder.length > 0) {
                e.preventDefault();
                setSelectedChip(chipOrder[chipOrder.length - 1] ?? null);
              }
            }}
          />
        </div>
        {hasQuery ? (
          <button
            type="button"
            className="omni-clear"
            aria-label={t("action.clear")}
            onClick={() => {
              applyOmni(EMPTY_OMNI, { pending: null });
              closeSession(EMPTY_OMNI);
            }}
          >
            <XCircleIcon size={14} />
          </button>
        ) : null}

        {editor === "bpm" ? (
          <OmniEditorAnchor>
            <BpmEditor
              value={{ min: value.bpmMin, max: value.bpmMax }}
              halfDouble={halfDouble}
              clearMaxOnMinEdit={session?.mode === "retrigger"}
              bpmValues={facetBpms}
              onChange={(next) => {
                applyOmni({ ...value, bpmMin: next.min, bpmMax: next.max });
              }}
              onToggleHalfDouble={onToggleHalfDouble}
              onConfirm={confirmEditor}
              onCancel={cancelEditor}
            />
          </OmniEditorAnchor>
        ) : null}
        {editor === "key" ? (
          <OmniEditorAnchor>
            <KeyEditor
              value={value.key}
              relative={relativeKey}
              rootCounts={facetRootCounts}
              onChange={(key: OmniKey | null) => {
                applyOmni({ ...value, key });
              }}
              onToggleRelative={onToggleRelativeKey}
              onConfirm={confirmEditor}
              onCancel={cancelEditor}
            />
          </OmniEditorAnchor>
        ) : null}
        {editor === "tag" ? (
          <OmniEditorAnchor>
            <TagEditor
              value={{ include: value.tagsInclude, exclude: value.tagsExclude }}
              tags={tags}
              tagCounts={facetTagCounts}
              onChange={(next) => {
                applyOmni({
                  ...value,
                  tagsInclude: next.include,
                  tagsExclude: next.exclude,
                });
              }}
              onConfirm={confirmEditor}
              onCancel={cancelEditor}
            />
          </OmniEditorAnchor>
        ) : null}
        {editor === "type" ? (
          <OmniEditorAnchor align="right">
            <TypeEditor
              value={value.sampleType}
              onChange={(sampleType) => {
                applyOmni({ ...value, sampleType });
              }}
              onConfirm={confirmEditor}
              onCancel={cancelEditor}
            />
          </OmniEditorAnchor>
        ) : null}

        {suggestOpen && !session ? (
          <SuggestionDropdown
            rows={suggestRows}
            highlight={suggestHi}
            emptyField={!value.text.trim()}
            anchorRef={inputRef}
            onHighlight={setSuggestHi}
            onPick={pickSuggestion}
          />
        ) : null}
      </div>

      <div className="omni-type-seg" role="group" aria-label={t("omni.type.label")}>
        {(
          [
            { id: "all" as const, label: t("omni.type.all"), Icon: RowsIcon },
            { id: "loop" as const, label: t("omni.type.loops"), Icon: RepeatIcon },
            {
              id: "one-shot" as const,
              label: t("omni.type.oneShots"),
              Icon: LightningIcon,
            },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={value.sampleType === id ? "on" : undefined}
            onClick={() => {
              applyOmni({ ...value, sampleType: id satisfies SampleTypeFilter });
            }}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      <div className="omni-actions">
        <button
          type="button"
          className={`omni-icon-btn${favoritesOnly ? " on" : ""}`}
          title={t("omni.favoritesOnly")}
          aria-label={t("omni.favoritesOnly")}
          aria-pressed={favoritesOnly}
          onClick={onToggleFavoritesOnly}
        >
          <StarIcon size={15} weight={favoritesOnly ? "fill" : "regular"} />
        </button>
        <div className="omni-columns">
          <button
            type="button"
            className={`omni-icon-btn${columnsOpen ? " on" : ""}`}
            title={t("omni.columns")}
            aria-label={t("omni.columns")}
            aria-expanded={columnsOpen}
            onPointerDown={(e) => {
              if (columnsOpen) e.stopPropagation();
            }}
            onClick={() => {
              setColumnsOpen((open) => !open);
            }}
          >
            <ColumnsIcon size={15} />
          </button>
          {columnsOpen ? (
            <Popover
              label={t("omni.columns")}
              onClose={() => {
                setColumnsOpen(false);
              }}
            >
              <div className="popover-label">{t("omni.columns")}</div>
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
});
