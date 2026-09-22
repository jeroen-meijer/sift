import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keys, matchesBinding, primaryModHeld, shiftHeld as isShiftHeld } from "../lib/bindings";
import { bpmFromBeats } from "../lib/bpm";
import { mergeColumnWidths, type ColumnWidths } from "../lib/columnWidths";
import { matchesHotkey } from "../lib/hotkey";
import {
  ipc,
  type AppSettings,
  type CustomAnalysisOpts,
  type DbStats,
  type FolderNode,
  type PeakData,
  type SampleRow,
  type SortColumn,
  type TagNode,
} from "../lib/ipc";
import { cachedRowPeaks } from "../lib/rowPeaks";
import { DetailPane } from "./DetailPane";
import { FolderSidebar } from "./FolderSidebar";
import { EMPTY_OMNI, omniHasQuery, type OmniState, type OptionalColumn } from "../lib/omni";
import { OmniSearch } from "./OmniSearch";
import { SampleMenu, type SampleAction } from "./SampleMenu";
import { SampleTable } from "./SampleTable";
import { SelectionBar } from "./SelectionBar";
import { StatusBar, type AnalysisBar } from "./StatusBar";
import { CustomAnalysisDialog } from "./dialogs/CustomAnalysisDialog";
import { RemoveMissingDialog } from "./dialogs/RemoveMissingDialog";
import { RemoveRootDialog } from "./dialogs/RemoveRootDialog";
import { TagPickerDialog } from "./dialogs/TagPickerDialog";
import type { Selection } from "./WaveformView";

const PLAYHEAD_POLL_MS = 50;
/** Wait for the selection to settle before writing a clip for it. */
const CLIP_RENDER_DEBOUNCE_MS = 250;
const MIN_CLIP_SECS = 0.01;

type Dialog =
  | { kind: "removeRoot"; node: FolderNode }
  | { kind: "removeMissing"; sample: SampleRow }
  | { kind: "customAnalysis" }
  | { kind: "tags" };

interface Props {
  settings: AppSettings;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  stats: DbStats;
  folders: FolderNode[];
  tags: TagNode[];
  analyzingIds: Set<number>;
  analysisBar: AnalysisBar | null;
  statusText: string | undefined;
  /** Bumped by the shell whenever the library changed underneath us. */
  refreshToken: number;
  onRefreshLibrary: () => void;
  onAddRoot: () => void;
  onManageTags: () => void;
  onAnalysisStart: () => void;
}

export function LibraryView({
  settings,
  onSettingChange,
  stats,
  folders,
  tags,
  analyzingIds,
  analysisBar,
  statusText,
  refreshToken,
  onRefreshLibrary,
  onAddRoot,
  onManageTags,
  onAnalysisStart,
}: Props) {
  const { t } = useTranslation("library");
  const [omni, setOmni] = useState<OmniState>(EMPTY_OMNI);
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<OptionalColumn>>(() => new Set());
  const [peaks, setPeaks] = useState<PeakData | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [clipPath, setClipPath] = useState<string | null>(null);
  /** Scrubbing a row wave must not be overwritten by play-on-select from 0. */
  const skipPlayOnSelect = useRef(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    sample: SampleRow;
    openPanel?: "key" | "bpm";
  } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [customOpts, setCustomOpts] = useState<CustomAnalysisOpts>({
    overwrite_tags: false,
    rerun_bpm: true,
    rerun_key: true,
    rerun_type: true,
  });
  const shiftHeld = useRef(false);
  const samplesRef = useRef<SampleRow[]>([]);
  const [hoverPreviewHeld, setHoverPreviewHeld] = useState(false);

  const focused = useMemo(
    () => samples.find((s) => s.id === focusedId) ?? null,
    [samples, focusedId],
  );
  const filtered = omniHasQuery(omni) || favoritesOnly;

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  /* ── data ──────────────────────────────────────────────────────────── */

  const refreshSamples = useCallback(async () => {
    /* Keep showing rows while a filter refreshes; only spin when the list is empty. */
    if (samplesRef.current.length === 0) setSamplesLoading(true);
    try {
      const rows = await ipc.listSamples({
        folder_prefix: omni.folder,
        text: omni.text || null,
        tag_path: omni.tags[0] ?? null,
        tag_paths: omni.tags,
        bpm_min: omni.bpmMin,
        bpm_max: omni.bpmMax,
        key: omni.key,
        half_double: settings.half_double_bpm,
        relative_key: settings.relative_key,
        favorites_only: favoritesOnly,
        sort_column: settings.sort_column,
        sort_direction: settings.sort_direction,
        limit: 5000,
        offset: 0,
      });
      setSamples(rows);
    } finally {
      setSamplesLoading(false);
    }
  }, [
    omni,
    favoritesOnly,
    settings.half_double_bpm,
    settings.relative_key,
    settings.sort_column,
    settings.sort_direction,
  ]);

  useEffect(() => {
    void refreshSamples().catch(console.error);
  }, [refreshSamples, refreshToken]);

  const reload = useCallback(() => {
    void refreshSamples().catch(console.error);
    onRefreshLibrary();
  }, [refreshSamples, onRefreshLibrary]);

  /* ── preview ───────────────────────────────────────────────────────── */

  const play = useCallback(
    (
      sampleId: number,
      startSecs: number | null,
      region?: { start: number; end: number } | null,
    ) => {
      setPlayingId(sampleId);
      void ipc.play(sampleId, startSecs, region).catch(console.error);
    },
    [],
  );

  /** Region to loop, only when the focused sample is a loop with a selection. */
  const loopRegion = useCallback(
    (sample: SampleRow | null | undefined, sel: Selection | null) => {
      if (sample?.sample_type !== "loop" || !sel) return null;
      if (sel.end - sel.start < MIN_CLIP_SECS) return null;
      return sel;
    },
    [],
  );

  useEffect(() => {
    if (focusedId == null) {
      setPeaks(null);
      setSelection(null);
      return;
    }
    setSelection(null);
    if (samplesRef.current.find((s) => s.id === focusedId)?.missing) {
      setPeaks(null);
      return;
    }
    void ipc
      .getPeaks(focusedId)
      .then(setPeaks)
      .catch(() => {
        setPeaks(null);
      });
    if (skipPlayOnSelect.current) {
      skipPlayOnSelect.current = false;
      return;
    }
    if (settings.play_on_select) play(focusedId, null, null);
  }, [focusedId, settings.play_on_select, play]);

  /* Poll the engine for a truth sample, then interpolate between ticks with
   * rAF so the playhead stays smooth on high-refresh displays. */
  useEffect(() => {
    if (playingId == null) {
      setPlayhead(null);
      return;
    }
    let pollTimer = 0;
    let raf = 0;
    let alive = true;
    let anchorSecs = 0;
    let anchorAt = performance.now();
    let moving = false;

    const paint = (now: number) => {
      if (!alive) return;
      const secs = moving ? anchorSecs + (now - anchorAt) / 1000 : anchorSecs;
      setPlayhead(secs);
      raf = window.requestAnimationFrame(paint);
    };

    const tick = () => {
      void ipc
        .playbackState()
        .then((state) => {
          if (!alive) return;
          anchorSecs = state.position_secs;
          anchorAt = performance.now();
          moving = state.playing;
          if (!state.playing && state.position_secs <= 0) setPlayingId(null);
        })
        .catch(() => undefined);
      pollTimer = window.setTimeout(tick, PLAYHEAD_POLL_MS);
    };

    tick();
    raf = window.requestAnimationFrame(paint);
    return () => {
      alive = false;
      window.clearTimeout(pollTimer);
      window.cancelAnimationFrame(raf);
    };
  }, [playingId]);

  const snapSecs = useCallback(
    (secs: number) => {
      const bpm = focused?.bpm;
      if (shiftHeld.current || settings.snap === "None" || bpm == null || bpm <= 0) return secs;
      const divisor = settings.snap === "1/4" ? 1 : settings.snap === "1/8" ? 2 : 4;
      const grid = 60 / bpm / divisor;
      return Math.round(secs / grid) * grid;
    },
    [focused, settings.snap],
  );

  /* ── selection ─────────────────────────────────────────────────────── */

  const selectRow = useCallback(
    (id: number, e: React.MouseEvent | React.KeyboardEvent) => {
      const mod = "metaKey" in e && primaryModHeld(e);
      const shift = "shiftKey" in e && isShiftHeld(e);
      /* Context menu selects the row but must not kick play-on-select. */
      const fromContextMenu = "type" in e && e.type === "contextmenu";
      /* Re-clicking the focused row restarts preview (Enter-equivalent). */
      if (id === focusedId && !mod && !shift && !fromContextMenu) {
        const row = samples.find((s) => s.id === id) ?? null;
        const region = loopRegion(row, selection);
        play(id, region?.start ?? null, region);
      }
      if (fromContextMenu) skipPlayOnSelect.current = true;
      setFocusedId(id);
      setSelectedIds((prev) => {
        if (mod) {
          const next = new Set(prev);
          if (!next.delete(id)) next.add(id);
          return next;
        }
        if (shift && focusedId != null) {
          const from = samples.findIndex((s) => s.id === focusedId);
          const to = samples.findIndex((s) => s.id === id);
          if (from >= 0 && to >= 0) {
            const next = new Set(prev);
            for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
              const row = samples[i];
              if (row) next.add(row.id);
            }
            return next;
          }
        }
        return new Set([id]);
      });
    },
    [focusedId, samples, selection, play, loopRegion],
  );

  const selectedSamples = useMemo(
    () => samples.filter((s) => selectedIds.has(s.id)),
    [samples, selectedIds],
  );

  const targetSamples = useCallback(
    (sample: SampleRow) => (selectedIds.has(sample.id) ? selectedSamples : [sample]),
    [selectedIds, selectedSamples],
  );

  /* ── drag ──────────────────────────────────────────────────────────── */

  const dragSelected = useCallback(() => {
    const paths = selectedSamples.filter((s) => !s.missing).map((s) => s.path);
    if (paths.length > 0) void ipc.startDrag(paths).catch(console.error);
  }, [selectedSamples]);

  /*
   * Render the clip once the selection settles. Decoding inside dragstart is
   * too late: macOS drops the drag session before the decode finishes.
   */
  useEffect(() => {
    setClipPath(null);
    if (focusedId == null || !selection || selection.end - selection.start < MIN_CLIP_SECS) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void ipc
        .renderClip(focusedId, selection.start, selection.end)
        .then((path) => {
          if (alive) setClipPath(path);
        })
        .catch(console.error);
    }, CLIP_RENDER_DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [focusedId, selection]);

  const dragClip = useCallback(() => {
    if (clipPath) void ipc.startDrag([clipPath]).catch(console.error);
  }, [clipPath]);

  /* ── actions ───────────────────────────────────────────────────────── */

  const analyze = useCallback(
    (ids: number[], custom: CustomAnalysisOpts | null) => {
      if (ids.length === 0) return;
      onAnalysisStart();
      void ipc.analyze(ids, custom).catch(console.error);
    },
    [onAnalysisStart],
  );

  const toggleFavorite = useCallback(
    (id: number, favorite: boolean) => {
      void ipc.setFavorite(id, favorite).then(reload).catch(console.error);
    },
    [reload],
  );

  const runAction = useCallback(
    (action: SampleAction, sample: SampleRow) => {
      const targets = targetSamples(sample);
      switch (action) {
        case "open":
          void openPath(sample.path).catch(console.error);
          break;
        case "favorite": {
          const next = !sample.favorite;
          void Promise.all(targets.map((s) => ipc.setFavorite(s.id, next)))
            .then(reload)
            .catch(console.error);
          break;
        }
        case "tags":
          setDialog({ kind: "tags" });
          break;
        case "type:loop":
        case "type:one-shot":
        case "type:none": {
          const value = action === "type:none" ? null : action.slice("type:".length);
          void Promise.all(targets.map((s) => ipc.setType(s.id, value)))
            .then(reload)
            .catch(console.error);
          break;
        }
        case "showParent":
          setOmni((prev) => ({ ...prev, folder: sample.parent_path }));
          break;
        case "reveal":
          void revealItemInDir(sample.path).catch(console.error);
          break;
        case "copyPath":
          void navigator.clipboard.writeText(targets.map((s) => s.path).join("\n"));
          break;
        case "copyFilename":
          void navigator.clipboard.writeText(targets.map((s) => s.filename).join("\n"));
          break;
        case "reanalyze":
          analyze(
            targets.filter((s) => !s.missing).map((s) => s.id),
            null,
          );
          break;
        case "customAnalysis":
          setDialog({ kind: "customAnalysis" });
          break;
        case "removeMissing":
          setDialog({ kind: "removeMissing", sample });
          break;
      }
    },
    [analyze, reload, targetSamples],
  );

  const menuTargets = useMemo(
    () => (menu ? targetSamples(menu.sample) : []),
    [menu, targetSamples],
  );

  const setBpmOn = useCallback(
    (rows: SampleRow[], bpm: number | null) => {
      if (rows.length === 0) return;
      void Promise.all(rows.map((row) => ipc.setBpm(row.id, bpm)))
        .then(reload)
        .catch(console.error);
    },
    [reload],
  );

  /** Each row gets the BPM its own length implies, so a mixed selection works. */
  const setBpmFromBeats = useCallback(
    (rows: SampleRow[], beats: number) => {
      const edits = rows
        .map((row) => ({ id: row.id, bpm: bpmFromBeats(row.duration_ms, beats, settings.bpm_round_whole) }))
        .filter((edit): edit is { id: number; bpm: number } => edit.bpm != null);
      if (edits.length === 0) return;
      void Promise.all(edits.map((edit) => ipc.setBpm(edit.id, edit.bpm)))
        .then(reload)
        .catch(console.error);
    },
    [reload, settings.bpm_round_whole],
  );

  /* ── keyboard ──────────────────────────────────────────────────────── */

  useEffect(() => {
    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

    const applyZeroCrossing = (freeTime: boolean) => {
      if (focusedId == null || !selection) return;
      void ipc
        .snapZeroCrossings(focusedId, [selection.start, selection.end])
        .then(([start, end]) => {
          if (start == null || end == null) return;
          setSelection(freeTime ? { start, end } : { start: snapSecs(start), end: snapSecs(end) });
        })
        .catch(console.error);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      shiftHeld.current = isShiftHeld(e);
      if (matchesHotkey(e, settings.hold_hover_hotkey)) {
        e.preventDefault();
        setHoverPreviewHeld(true);
        return;
      }
      if (isTyping(e.target)) return;

      if (matchesBinding(e, keys.redo)) {
        e.preventDefault();
        void ipc.redo().then((ok) => {
          if (ok) reload();
        });
        return;
      }
      if (matchesBinding(e, keys.undo)) {
        e.preventDefault();
        void ipc.undo().then((ok) => {
          if (ok) reload();
        });
        return;
      }
      if (matchesBinding(e, keys.open) && focused) {
        e.preventDefault();
        void openPath(focused.path).catch(console.error);
        return;
      }
      if (matchesBinding(e, keys.reveal) && focused) {
        e.preventDefault();
        void revealItemInDir(focused.path).catch(console.error);
        return;
      }
      if (matchesBinding(e, keys.copyPath) && selectedSamples.length > 0) {
        e.preventDefault();
        void navigator.clipboard.writeText(selectedSamples.map((s) => s.path).join("\n"));
        return;
      }
      if (matchesBinding(e, keys.copyFilename) && selectedSamples.length > 0) {
        e.preventDefault();
        void navigator.clipboard.writeText(selectedSamples.map((s) => s.filename).join("\n"));
        return;
      }
      if (primaryModHeld(e)) return;

      if (matchesBinding(e, keys.favorite) && focused) {
        e.preventDefault();
        e.stopPropagation();
        runAction("favorite", focused);
        return;
      }
      if (matchesBinding(e, keys.tags) && focused) {
        e.preventDefault();
        e.stopPropagation();
        setDialog({ kind: "tags" });
        return;
      }
      if (matchesBinding(e, keys.cycleType) && focused) {
        e.preventDefault();
        e.stopPropagation();
        const order = [null, "loop", "one-shot"] as const;
        const idx = order.findIndex((value) => value === focused.sample_type);
        const next = order[(idx < 0 ? 0 : idx + 1) % order.length] ?? null;
        const action =
          next == null ? "type:none" : next === "loop" ? "type:loop" : "type:one-shot";
        runAction(action, focused);
        return;
      }
      if ((matchesBinding(e, keys.setKey) || matchesBinding(e, keys.setBpm)) && focused) {
        e.preventDefault();
        e.stopPropagation();
        const el = document.querySelector(`[data-sample-id="${String(focused.id)}"]`);
        const rect = el instanceof HTMLElement ? el.getBoundingClientRect() : null;
        setMenu({
          x: rect ? rect.left + 48 : Math.round(window.innerWidth / 2 - 100),
          y: rect ? rect.bottom - 2 : Math.round(window.innerHeight / 3),
          sample: focused,
          openPanel: matchesBinding(e, keys.setKey) ? "key" : "bpm",
        });
        return;
      }
      if (matchesBinding(e, keys.zeroCrossing)) {
        e.preventDefault();
        applyZeroCrossing(isShiftHeld(e));
        return;
      }
      if (matchesBinding(e, keys.play) && focusedId != null) {
        e.preventDefault();
        const region = loopRegion(focused, selection);
        play(focusedId, region?.start ?? 0, region);
        return;
      }
      if (matchesBinding(e, keys.pause)) {
        e.preventDefault();
        void ipc
          .playbackState()
          .then((state) => (state.playing ? ipc.pause() : ipc.resume()))
          .catch(console.error);
        return;
      }
      if (matchesBinding(e, keys.selectDown) || matchesBinding(e, keys.selectUp)) {
        e.preventDefault();
        if (samples.length === 0) return;
        const current = focusedId == null ? -1 : samples.findIndex((s) => s.id === focusedId);
        const next = matchesBinding(e, keys.selectDown)
          ? Math.min(samples.length - 1, current + 1)
          : Math.max(0, (current < 0 ? 0 : current) - 1);
        const row = samples[next];
        if (!row) return;
        setFocusedId(row.id);
        setSelectedIds(new Set([row.id]));
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      shiftHeld.current = isShiftHeld(e);
      if (matchesHotkey(e, settings.hold_hover_hotkey)) setHoverPreviewHeld(false);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [
    focused,
    focusedId,
    loopRegion,
    play,
    reload,
    runAction,
    samples,
    selectedSamples,
    selection,
    settings.hold_hover_hotkey,
    snapSecs,
  ]);

  /* ── render ────────────────────────────────────────────────────────── */

  const selectedBytes = selectedSamples.reduce((sum, s) => sum + (s.size_bytes ?? 0), 0);
  const commonTagIds = useMemo(() => {
    if (selectedSamples.length === 0) return new Set<number>();
    const [first, ...rest] = selectedSamples;
    let ids = new Set((first?.tags ?? []).map((tag) => tag.id));
    for (const sample of rest) {
      const here = new Set(sample.tags.map((tag) => tag.id));
      ids = new Set([...ids].filter((id) => here.has(id)));
    }
    return ids;
  }, [selectedSamples]);

  return (
    <>
      <div className="library-layout">
        <FolderSidebar
          folders={folders}
          tags={tags}
          selectedPath={omni.folder}
          selectedTagPath={omni.tags[0] ?? null}
          onSelectFolder={(path) => {
            setOmni((prev) => ({ ...prev, folder: path, tags: [] }));
            setSelectedIds(new Set());
            setFocusedId(null);
          }}
          onSelectTag={(path) => {
            setOmni((prev) => ({ ...prev, tags: path ? [path] : [] }));
            setSelectedIds(new Set());
            setFocusedId(null);
          }}
          onAddRoot={onAddRoot}
          onRemoveRoot={(node) => {
            setDialog({ kind: "removeRoot", node });
          }}
          onManageTags={onManageTags}
        />

        <main className="library-main">
          <OmniSearch
            value={omni}
            onChange={setOmni}
            folders={folders}
            halfDouble={settings.half_double_bpm}
            relativeKey={settings.relative_key}
            onToggleHalfDouble={() => {
              onSettingChange("half_double_bpm", !settings.half_double_bpm);
            }}
            onToggleRelativeKey={() => {
              onSettingChange("relative_key", !settings.relative_key);
            }}
            showWaveforms={settings.row_waveforms}
            onToggleWaveforms={() => {
              onSettingChange("row_waveforms", !settings.row_waveforms);
            }}
            favoritesOnly={favoritesOnly}
            onToggleFavoritesOnly={() => {
              setFavoritesOnly((on) => !on);
            }}
            hiddenColumns={hiddenColumns}
            onToggleColumn={(column) => {
              setHiddenColumns((prev) => {
                const next = new Set(prev);
                if (!next.delete(column)) next.add(column);
                return next;
              });
            }}
            columnLabels={{
              type: t("colType"),
              bpm: t("colBpm"),
              key: t("colKey"),
              tags: t("colTags"),
            }}
          />

          <SampleTable
            samples={samples}
            indexedCount={stats.samples}
            loading={samplesLoading}
            selectedIds={selectedIds}
            playingId={playingId}
            playingProgress={
              playhead != null && peaks && peaks.duration_ms > 0
                ? Math.min(1, playhead / (peaks.duration_ms / 1000))
                : null
            }
            analyzingIds={analyzingIds}
            showWaveforms={settings.row_waveforms}
            coloredWaveforms={settings.colored_waveforms}
            hiddenColumns={hiddenColumns}
            columnWidths={mergeColumnWidths(settings.column_widths)}
            sortColumn={settings.sort_column}
            sortDirection={settings.sort_direction}
            highlightText={omni.text}
            hoverPreviewHeld={hoverPreviewHeld}
            onSelect={selectRow}
            onHoverPreview={(id) => {
              skipPlayOnSelect.current = true;
              setFocusedId(id);
              play(id, 0, null);
            }}
            onToggleFavorite={toggleFavorite}
            onSort={(column: SortColumn) => {
              if (settings.sort_column === column) {
                if (settings.sort_direction === "asc") {
                  onSettingChange("sort_direction", "desc");
                } else {
                  /* Third click: drop column sort and return to name ascending. */
                  onSettingChange("sort_column", "name");
                  onSettingChange("sort_direction", "asc");
                }
              } else {
                onSettingChange("sort_column", column);
                onSettingChange("sort_direction", "asc");
              }
            }}
            onColumnWidthsChange={(widths: ColumnWidths) => {
              onSettingChange("column_widths", widths);
            }}
            onOpenMenu={(x, y, sample) => {
              setMenu({ x, y, sample });
            }}
            onDragSelected={dragSelected}
            onScrubRow={(sample, fraction) => {
              const fromSample = (sample.duration_ms ?? 0) / 1000;
              const fromPeaks = (cachedRowPeaks(sample.id)?.duration_ms ?? 0) / 1000;
              const duration = fromSample > 0 ? fromSample : fromPeaks;
              const start = duration > 0 ? fraction * duration : 0;
              skipPlayOnSelect.current = true;
              setFocusedId(sample.id);
              setSelectedIds(new Set([sample.id]));
              setPlayhead(start);
              play(sample.id, start, null);
            }}
          />

          {selectedIds.size > 1 ? (
            <SelectionBar count={selectedIds.size} bytes={selectedBytes} />
          ) : null}

          <DetailPane
            sample={focused}
            peaks={peaks}
            allTags={tags}
            snap={settings.snap}
            waveformMode={settings.waveform_view}
            coloredWaveforms={settings.colored_waveforms}
            playheadSecs={playingId === focusedId ? playhead : null}
            selection={selection}
            loopPreview={settings.loop_preview}
            gainDb={settings.preview_gain_db}
            onToggleFavorite={() => {
              if (focused) toggleFavorite(focused.id, !focused.favorite);
            }}
            onAddTag={(tagId) => {
              if (focused) void ipc.addSampleTag(focused.id, tagId).then(reload).catch(console.error);
            }}
            onRemoveTag={(tagId) => {
              if (focused)
                void ipc.removeSampleTag(focused.id, tagId).then(reload).catch(console.error);
            }}
            onSeek={(secs) => {
              if (focusedId == null) return;
              const snapped = snapSecs(secs);
              const region = loopRegion(focused, selection);
              play(focusedId, snapped, region);
              setPlayhead(snapped);
            }}
            snapPointer={snapSecs}
            onSelect={(next) => {
              const snapped = next
                ? { start: snapSecs(next.start), end: snapSecs(next.end) }
                : null;
              setSelection(snapped);
              if (focusedId == null || !focused || focused.missing) return;
              const region = loopRegion(focused, snapped);
              if (region) {
                if (playingId === focusedId) {
                  void ipc.setPlayRegion(region).catch(console.error);
                } else {
                  play(focusedId, region.start, region);
                }
              } else if (!snapped && playingId === focusedId) {
                void ipc.setPlayRegion(null).catch(console.error);
              }
            }}
            clipReady={clipPath != null}
            onDragClip={dragClip}
            onSnapChange={(snap) => {
              onSettingChange("snap", snap);
            }}
            onLoopChange={(on) => {
              onSettingChange("loop_preview", on);
            }}
            onGainChange={(db) => {
              onSettingChange("preview_gain_db", db);
            }}
            onRecheckPath={reload}
            onLocate={() => {
              if (focused) void revealItemInDir(focused.parent_path).catch(console.error);
            }}
            onRemoveMissing={() => {
              if (focused) setDialog({ kind: "removeMissing", sample: focused });
            }}
          />
        </main>
      </div>

      <StatusBar
        rootCount={stats.roots}
        fileCount={stats.samples}
        shownCount={samples.length}
        filtered={filtered}
        statusText={statusText}
        analysis={analysisBar}
      />

      {menu ? (
        <SampleMenu
          x={menu.x}
          y={menu.y}
          sample={menu.sample}
          targets={menuTargets}
          bpmMin={settings.bpm_range_min}
          bpmMax={settings.bpm_range_max}
          roundBpm={settings.bpm_round_whole}
          {...(menu.openPanel != null ? { openPanel: menu.openPanel } : {})}
          onRoundBpmChange={(round) => {
            onSettingChange("bpm_round_whole", round);
          }}
          onSetBpm={(bpm) => {
            setBpmOn(menuTargets, bpm);
          }}
          onSetBpmFromBeats={(beats) => {
            setBpmFromBeats(menuTargets, beats);
          }}
          onSetKey={(key) => {
            if (menuTargets.length === 0) return;
            void Promise.all(menuTargets.map((row) => ipc.setKey(row.id, key)))
              .then(reload)
              .catch(console.error);
          }}
          onSelect={runAction}
          onClose={() => {
            setMenu(null);
          }}
        />
      ) : null}

      {dialog?.kind === "removeRoot" ? (
        <RemoveRootDialog
          path={dialog.node.path}
          sampleCount={dialog.node.sample_count}
          onCancel={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            const rootId = dialog.node.root_id;
            setDialog(null);
            void ipc.removeRoot(rootId).then(reload).catch(console.error);
          }}
        />
      ) : null}

      {dialog?.kind === "removeMissing" ? (
        <RemoveMissingDialog
          sample={dialog.sample}
          otherMissing={Math.max(0, stats.missing - 1)}
          onCancel={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            const id = dialog.sample.id;
            setDialog(null);
            setFocusedId(null);
            setSelectedIds(new Set());
            void ipc.removeSample(id).then(reload).catch(console.error);
          }}
          onRemoveAll={() => {
            setDialog(null);
            setFocusedId(null);
            setSelectedIds(new Set());
            void ipc.purgeMissing().then(reload).catch(console.error);
          }}
        />
      ) : null}

      {dialog?.kind === "customAnalysis" ? (
        <CustomAnalysisDialog
          count={selectedSamples.length}
          opts={customOpts}
          onOptsChange={setCustomOpts}
          bpmMin={settings.bpm_range_min}
          bpmMax={settings.bpm_range_max}
          onBpmRangeChange={(min, max) => {
            onSettingChange("bpm_range_min", min);
            onSettingChange("bpm_range_max", max);
          }}
          onCancel={() => {
            setDialog(null);
          }}
          onRun={() => {
            setDialog(null);
            analyze(
              selectedSamples.filter((s) => !s.missing).map((s) => s.id),
              customOpts,
            );
          }}
        />
      ) : null}

      {dialog?.kind === "tags" ? (
        <TagPickerDialog
          tags={tags}
          checkedIds={commonTagIds}
          sampleCount={selectedSamples.length}
          onToggle={(tagId, next) => {
            void Promise.all(
              selectedSamples.map((s) =>
                next ? ipc.addSampleTag(s.id, tagId) : ipc.removeSampleTag(s.id, tagId),
              ),
            )
              .then(reload)
              .catch(console.error);
          }}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
}
