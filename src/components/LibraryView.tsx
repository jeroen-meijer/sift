import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { bpmFromBeats } from "../lib/bpm";
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
import { SetValueDialog } from "./dialogs/SetValueDialog";
import { TagPickerDialog } from "./dialogs/TagPickerDialog";
import type { Selection } from "./WaveformView";

const PLAYHEAD_POLL_MS = 40;
/** Wait for the selection to settle before writing a clip for it. */
const CLIP_RENDER_DEBOUNCE_MS = 250;
const MIN_CLIP_SECS = 0.01;

type Dialog =
  | { kind: "removeRoot"; node: FolderNode }
  | { kind: "removeMissing"; sample: SampleRow }
  | { kind: "customAnalysis" }
  | { kind: "setKey" }
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<OptionalColumn>>(() => new Set());
  const [peaks, setPeaks] = useState<PeakData | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [clipPath, setClipPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; sample: SampleRow } | null>(null);
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

  const play = useCallback((sampleId: number, startSecs: number | null) => {
    setPlayingId(sampleId);
    void ipc.play(sampleId, startSecs).catch(console.error);
  }, []);

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
    if (settings.play_on_select) play(focusedId, null);
  }, [focusedId, settings.play_on_select, play]);

  /* Poll the engine only while something is playing. */
  useEffect(() => {
    if (playingId == null) {
      setPlayhead(null);
      return;
    }
    let timer = 0;
    let alive = true;
    const tick = () => {
      void ipc
        .playbackState()
        .then((state) => {
          if (!alive) return;
          setPlayhead(state.position_secs);
          if (!state.playing && state.position_secs <= 0) setPlayingId(null);
        })
        .catch(() => undefined);
      timer = window.setTimeout(tick, PLAYHEAD_POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
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
      setFocusedId(id);
      setSelectedIds((prev) => {
        if (e.metaKey || e.ctrlKey) {
          const next = new Set(prev);
          if (!next.delete(id)) next.add(id);
          return next;
        }
        if (e.shiftKey && focusedId != null) {
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
    [focusedId, samples],
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
   * Render the clip as soon as the selection settles. Doing it inside dragstart
   * instead would put a decode between the gesture and the drag, and macOS has
   * dropped the drag session by the time that finishes.
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
        case "key":
          setDialog({ kind: "setKey" });
          break;
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
      shiftHeld.current = e.shiftKey;
      if (matchesHotkey(e, settings.hold_hover_hotkey)) {
        e.preventDefault();
        setHoverPreviewHeld(true);
        return;
      }
      if (isTyping(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        void (e.shiftKey ? ipc.redo() : ipc.undo()).then((ok) => {
          if (ok) reload();
        });
        return;
      }
      if (mod && key === "o" && focused) {
        e.preventDefault();
        void openPath(focused.path).catch(console.error);
        return;
      }
      if (mod && key === "r" && focused) {
        e.preventDefault();
        void revealItemInDir(focused.path).catch(console.error);
        return;
      }
      if (mod && key === "c" && selectedSamples.length > 0) {
        e.preventDefault();
        const values = selectedSamples.map((s) => (e.altKey ? s.path : s.filename));
        void navigator.clipboard.writeText(values.join("\n"));
        return;
      }
      if (mod) return;

      if (key === "f" && focused) {
        e.preventDefault();
        runAction("favorite", focused);
        return;
      }
      if (key === "t" && focused) {
        e.preventDefault();
        setDialog({ kind: "tags" });
        return;
      }
      if (key === "z") {
        e.preventDefault();
        applyZeroCrossing(e.shiftKey);
        return;
      }
      if (e.key === "Enter" && focusedId != null) {
        e.preventDefault();
        play(focusedId, 0);
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        void ipc.pause().catch(() => ipc.resume());
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (samples.length === 0) return;
        const current = focusedId == null ? -1 : samples.findIndex((s) => s.id === focusedId);
        const next =
          e.key === "ArrowDown"
            ? Math.min(samples.length - 1, current + 1)
            : Math.max(0, (current < 0 ? 0 : current) - 1);
        const row = samples[next];
        if (!row) return;
        setFocusedId(row.id);
        setSelectedIds(new Set([row.id]));
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      shiftHeld.current = e.shiftKey;
      if (matchesHotkey(e, settings.hold_hover_hotkey)) setHoverPreviewHeld(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    focused,
    focusedId,
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
            selectedIds={selectedIds}
            playingId={playingId}
            playingProgress={
              playhead != null && peaks && peaks.duration_ms > 0
                ? Math.min(1, playhead / (peaks.duration_ms / 1000))
                : null
            }
            analyzingIds={analyzingIds}
            showWaveforms={settings.row_waveforms}
            hiddenColumns={hiddenColumns}
            sortColumn={settings.sort_column}
            sortDirection={settings.sort_direction}
            highlightText={omni.text}
            hoverPreviewHeld={hoverPreviewHeld}
            onSelect={selectRow}
            onHoverPreview={(id) => {
              setFocusedId(id);
              play(id, 0);
            }}
            onToggleFavorite={toggleFavorite}
            onSort={(column: SortColumn) => {
              if (settings.sort_column === column) {
                onSettingChange("sort_direction", settings.sort_direction === "asc" ? "desc" : "asc");
              } else {
                onSettingChange("sort_column", column);
                onSettingChange("sort_direction", "asc");
              }
            }}
            onOpenMenu={(x, y, sample) => {
              setMenu({ x, y, sample });
            }}
            onDragSelected={dragSelected}
            onScrubRow={(sample, fraction) => {
              const duration = (sample.duration_ms ?? 0) / 1000;
              setFocusedId(sample.id);
              setSelectedIds(new Set([sample.id]));
              play(sample.id, duration > 0 ? fraction * duration : 0);
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
              play(focusedId, snapped);
              setPlayhead(snapped);
            }}
            onSelect={(next) => {
              setSelection(
                next ? { start: snapSecs(next.start), end: snapSecs(next.end) } : null,
              );
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
          onRoundBpmChange={(round) => {
            onSettingChange("bpm_round_whole", round);
          }}
          onSetBpm={(bpm) => {
            setBpmOn(menuTargets, bpm);
          }}
          onSetBpmFromBeats={(beats) => {
            setBpmFromBeats(menuTargets, beats);
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

      {dialog?.kind === "setKey" ? (
        <SetValueDialog
          title={t("setKeyTitle")}
          body={t("setKeyBody", { count: selectedSamples.length })}
          initial={focused?.key_name ?? ""}
          placeholder="A min"
          onCancel={() => {
            setDialog(null);
          }}
          onApply={(value) => {
            setDialog(null);
            const key = value.trim() === "" ? null : value.trim();
            void Promise.all(selectedSamples.map((s) => ipc.setKey(s.id, key)))
              .then(reload)
              .catch(console.error);
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
