import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keys, matchesBinding, primaryModHeld, shiftHeld as isShiftHeld } from "../lib/bindings";
import { bpmFromBeats } from "../lib/bpm";
import { mergeColumnWidths, type ColumnWidths, type ResizableColumn } from "../lib/columnWidths";
import { mergeColumnOrder } from "../lib/columnOrder";
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
import { playheadStore, rowChangesStore } from "../lib/liveStores";
import { patchRows } from "../lib/patchRows";
import { getRowPeaks } from "../lib/rowPeaks";
import { isProfileOn, profileEvent, profileMark, useRenderTiming } from "../lib/profile";
import { useStableCallback } from "../lib/useStableCallback";
import { DetailPane } from "./DetailPane";
import { FolderSidebar } from "./FolderSidebar";
import { EMPTY_OMNI, omniHasQuery, type OmniState, type OptionalColumn } from "../lib/omni";
import { OmniSearch } from "./OmniSearch";
import { SampleMenu, type SampleAction } from "./SampleMenu";
import { SampleTable } from "./SampleTable";
import { SelectionBar } from "./SelectionBar";
import { StatusBar } from "./StatusBar";
import { CustomAnalysisDialog } from "./dialogs/CustomAnalysisDialog";
import { RemoveMissingDialog } from "./dialogs/RemoveMissingDialog";
import { RemoveRootDialog } from "./dialogs/RemoveRootDialog";
import { TagPickerDialog } from "./dialogs/TagPickerDialog";
import type { Selection } from "./WaveformView";

const PLAYHEAD_POLL_MS = 50;
/** Wait for the selection to settle before writing a clip for it. */
const CLIP_RENDER_DEBOUNCE_MS = 250;
const MIN_CLIP_SECS = 0.01;
/** Neighbors longer than this are not decoded ahead of time. */
const PREFETCH_MAX_DURATION_MS = 30_000;

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
  statusText,
  refreshToken,
  onRefreshLibrary,
  onAddRoot,
  onManageTags,
  onAnalysisStart,
}: Props) {
  const { t } = useTranslation("library");
  useRenderTiming("LibraryView");
  const [omni, setOmni] = useState<OmniState>(EMPTY_OMNI);
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<OptionalColumn>>(() => new Set());
  const [peaks, setPeaks] = useState<PeakData | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
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
  const listApplyAt = useRef<{ at: number; n: number } | null>(null);
  /** Folder whose cloud rows were last re-statted (availability check). */
  const availCheckedFolder = useRef<string | null>(null);
  const [hoverPreviewHeld, setHoverPreviewHeld] = useState(false);

  /*
   * The detail pane follows the sample you picked, not the current list: a
   * search or folder change that filters it out must not clear the pane (or
   * stop showing what is playing). `focusedRow` keeps the last known row; it
   * changes when you pick another sample, when the row changes (for example
   * it goes missing), or when the sample is deleted.
   */
  const [focusedRow, setFocusedRow] = useState<SampleRow | null>(null);
  const inList = useMemo(
    () => (focusedId == null ? null : (samples.find((s) => s.id === focusedId) ?? null)),
    [samples, focusedId],
  );
  const focused = inList ?? (focusedRow?.id === focusedId ? focusedRow : null);
  const filtered = omniHasQuery(omni) || favoritesOnly;

  useEffect(() => {
    samplesRef.current = samples;
  }, [samples]);

  /* Keep the detail row fresh while it is in the list; when it is not (search,
   * folder change), ask the backend once: deleted clears it, anything else
   * (including "missing") updates it. */
  useEffect(() => {
    if (focusedId == null) {
      setFocusedRow(null);
      return;
    }
    if (inList) {
      setFocusedRow(inList);
      return;
    }
    let alive = true;
    void ipc
      .getSamples([focusedId])
      .then(([row]) => {
        if (!alive) return;
        if (row) setFocusedRow(row);
        else setFocusedId(null);
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
    /* refreshToken: a structural change (deleted, gone missing) re-checks it. */
  }, [focusedId, inList, refreshToken]);

  /* ── data ──────────────────────────────────────────────────────────── */

  const refreshSamples = useCallback(async () => {
    const hasScope =
      Boolean(omni.folder) ||
      Boolean(omni.text) ||
      omni.tags.length > 0 ||
      omni.bpmMin != null ||
      omni.bpmMax != null ||
      Boolean(omni.key) ||
      favoritesOnly;
    if (!hasScope) {
      setSamples([]);
      setSamplesLoading(false);
      return;
    }
    /* Keep showing rows while a filter refreshes; only spin when the list is empty. */
    if (samplesRef.current.length === 0) setSamplesLoading(true);
    try {
      const t0 = performance.now();
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
      const applyAt = performance.now();
      setSamples(rows);
      if (isProfileOn()) {
        /* Round trip of the list IPC (Rust time is `ipc.list_samples`). */
        profileMark(
          "fe.list_ipc",
          applyAt - t0,
          `n=${String(rows.length)} folder=${omni.folder ?? ""}`,
        );
        listApplyAt.current = { at: applyAt, n: rows.length };
      }
      /* Re-stat cloud rows once per folder open, not on every refresh. */
      const folderKey = omni.folder ?? "";
      if (availCheckedFolder.current === folderKey) return;
      availCheckedFolder.current = folderKey;
      const cloudPaths = rows
        .filter((r) => r.availability === "cloud" || r.availability === "unknown")
        .map((r) => r.path)
        .slice(0, 200);
      if (cloudPaths.length > 0) {
        if (isProfileOn()) {
          profileEvent("fe.avail_refresh_start", `n=${String(cloudPaths.length)}`);
        }
        const refreshAt = performance.now();
        void ipc
          .refreshSampleAvailability(cloudPaths)
          .then((changed) => {
            if (isProfileOn()) {
              profileMark(
                "fe.avail_refresh",
                performance.now() - refreshAt,
                `paths=${String(cloudPaths.length)} changed=${String(changed)}`,
              );
            }
          })
          .catch(() => {
            /* ignore */
          });
      }
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

  /* fe.list_commit: from setSamples to the table committed (profile builds). */
  useLayoutEffect(() => {
    const pending = listApplyAt.current;
    if (!pending) return;
    listApplyAt.current = null;
    profileMark("fe.list_commit", performance.now() - pending.at, `n=${String(pending.n)}`);
  }, [samples]);

  /** Full refresh: list, tree, stats and tags. For structural changes only. */
  const reload = useCallback(() => {
    void refreshSamples().catch(console.error);
    onRefreshLibrary();
  }, [refreshSamples, onRefreshLibrary]);

  /** Refetch these rows and swap them in place; the rest of the list is untouched. */
  const patchFromServer = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    void ipc
      .getSamples(ids)
      .then((rows) => {
        setSamples((prev) => patchRows(prev, rows));
      })
      .catch(console.error);
  }, []);

  /* Analysis results / availability flips from the backend: patch visible rows,
   * and reload the detail waveform when the focused sample was just analyzed. */
  const focusedIdRef = useRef<number | null>(null);
  useEffect(() => {
    focusedIdRef.current = focusedId;
  }, [focusedId]);
  useEffect(
    () =>
      rowChangesStore.subscribe(() => {
        const { ids } = rowChangesStore.get();
        const present = new Set(samplesRef.current.map((s) => s.id));
        const hit = ids.filter((id) => present.has(id));
        patchFromServer(hit);
        const focusId = focusedIdRef.current;
        if (focusId != null && ids.includes(focusId) && !present.has(focusId)) {
          /* The detail row is filtered out of the list: refresh it directly. */
          void ipc
            .getSamples([focusId])
            .then(([row]) => {
              if (row && focusedIdRef.current === focusId) setFocusedRow(row);
            })
            .catch(console.error);
        }
        if (focusId != null && ids.includes(focusId)) {
          void ipc
            .getPeaks(focusId)
            .then((data) => {
              if (focusedIdRef.current === focusId && data.bucket_count > 0) setPeaks(data);
            })
            .catch(() => undefined);
        }
      }),
    [patchFromServer],
  );

  /* ── preview ───────────────────────────────────────────────────────── */

  const play = useCallback(
    (
      sampleId: number,
      startSecs: number | null,
      region?: { start: number; end: number } | null,
    ) => {
      const row = samplesRef.current.find((s) => s.id === sampleId);
      if (row && (row.missing || row.availability !== "local")) return;
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
    const focusedRow = samplesRef.current.find((s) => s.id === focusedId);
    if (!focusedRow || focusedRow.missing || focusedRow.availability !== "local") {
      setPeaks(null);
      return;
    }
    /* Warm only the next row, and only short files: a full decode of a long
     * file on every selection change cost memory and CPU for a guess. */
    const idx = samplesRef.current.findIndex((s) => s.id === focusedId);
    const warmIds: number[] = [];
    const next = samplesRef.current[idx + 1];
    if (
      next &&
      !next.missing &&
      next.availability === "local" &&
      next.duration_ms != null &&
      next.duration_ms <= PREFETCH_MAX_DURATION_MS
    ) {
      warmIds.push(next.id);
    }
    void ipc.prefetchDecode(warmIds).catch(() => {
      /* best-effort */
    });
    /* Waits for analysis when the sample has no peakfile yet (front of the queue). */
    void ipc
      .getPeaks(focusedId, true)
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
      playheadStore.set(null);
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
      /* Store write, not React state: only the playhead elements move. */
      playheadStore.set(secs);
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
      /* Flip the star right away, then reconcile with the stored row. */
      setSamples((prev) => prev.map((s) => (s.id === id ? { ...s, favorite } : s)));
      void ipc
        .setFavorite(id, favorite)
        .then(() => {
          patchFromServer([id]);
        })
        .catch(console.error);
    },
    [patchFromServer],
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
          const ids = targets.map((s) => s.id);
          void Promise.all(ids.map((id) => ipc.setFavorite(id, next)))
            .then(() => {
              patchFromServer(ids);
            })
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
          const ids = targets.map((s) => s.id);
          void Promise.all(ids.map((id) => ipc.setType(id, value)))
            .then(() => {
              patchFromServer(ids);
            })
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
    [analyze, patchFromServer, targetSamples],
  );

  const menuTargets = useMemo(
    () => (menu ? targetSamples(menu.sample) : []),
    [menu, targetSamples],
  );

  const setBpmOn = useCallback(
    (rows: SampleRow[], bpm: number | null) => {
      if (rows.length === 0) return;
      void Promise.all(rows.map((row) => ipc.setBpm(row.id, bpm)))
        .then(() => {
          patchFromServer(rows.map((row) => row.id));
        })
        .catch(console.error);
    },
    [patchFromServer],
  );

  /** Each row gets the BPM its own length implies, so a mixed selection works. */
  const setBpmFromBeats = useCallback(
    (rows: SampleRow[], beats: number) => {
      const edits = rows
        .map((row) => ({ id: row.id, bpm: bpmFromBeats(row.duration_ms, beats, settings.bpm_round_whole) }))
        .filter((edit): edit is { id: number; bpm: number } => edit.bpm != null);
      if (edits.length === 0) return;
      void Promise.all(edits.map((edit) => ipc.setBpm(edit.id, edit.bpm)))
        .then(() => {
          patchFromServer(edits.map((edit) => edit.id));
        })
        .catch(console.error);
    },
    [patchFromServer, settings.bpm_round_whole],
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
          if (ok) void refreshSamples().catch(console.error);
        });
        return;
      }
      if (matchesBinding(e, keys.undo)) {
        e.preventDefault();
        void ipc.undo().then((ok) => {
          if (ok) void refreshSamples().catch(console.error);
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
    refreshSamples,
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

  /* ── stable props for memoized children ──────────────────────────────
   * FolderSidebar, SampleTable, DetailPane, OmniSearch and StatusBar are
   * memoized. Inline arrows would give them new props on every render, so
   * every handler below keeps one identity for the life of the view. */

  /* Changing folder or tag clears the multi-selection but keeps the detail
   * pane on the sample you picked (it may keep playing). */
  const onSelectFolder = useStableCallback((path: string) => {
    setOmni((prev) => ({ ...prev, folder: path, tags: [] }));
    setSelectedIds(new Set());
  });
  const onSelectTag = useStableCallback((path: string | null) => {
    setOmni((prev) => ({ ...prev, tags: path ? [path] : [] }));
    setSelectedIds(new Set());
  });
  const onRemoveRoot = useStableCallback((node: FolderNode) => {
    setDialog({ kind: "removeRoot", node });
  });
  const onToggleHalfDouble = useStableCallback(() => {
    onSettingChange("half_double_bpm", !settings.half_double_bpm);
  });
  const onToggleRelativeKey = useStableCallback(() => {
    onSettingChange("relative_key", !settings.relative_key);
  });
  const onToggleWaveforms = useStableCallback(() => {
    onSettingChange("row_waveforms", !settings.row_waveforms);
  });
  const onToggleFavoritesOnly = useStableCallback(() => {
    setFavoritesOnly((on) => !on);
  });
  const onToggleColumn = useStableCallback((column: OptionalColumn) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (!next.delete(column)) next.add(column);
      return next;
    });
  });
  const columnLabels = useMemo(
    () => ({ type: t("colType"), bpm: t("colBpm"), key: t("colKey"), tags: t("colTags") }),
    [t],
  );
  const columnWidths = useMemo(
    () => mergeColumnWidths(settings.column_widths),
    [settings.column_widths],
  );
  const columnOrder = useMemo(
    () => mergeColumnOrder(settings.column_order),
    [settings.column_order],
  );
  const onSelectRow = useStableCallback(selectRow);
  const onHoverPreview = useStableCallback((id: number) => {
    skipPlayOnSelect.current = true;
    setFocusedId(id);
    play(id, 0, null);
  });
  const onToggleFavoriteRow = useStableCallback(toggleFavorite);
  const onSort = useStableCallback((column: SortColumn) => {
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
  });
  const onColumnWidthsChange = useStableCallback((widths: ColumnWidths) => {
    onSettingChange("column_widths", widths);
  });
  const onColumnOrderChange = useStableCallback((order: ResizableColumn[]) => {
    onSettingChange("column_order", order);
  });
  const onOpenMenu = useStableCallback((x: number, y: number, sample: SampleRow) => {
    setMenu({ x, y, sample });
  });
  const onDragSelected = useStableCallback(dragSelected);
  const onScrubRow = useStableCallback((sample: SampleRow, fraction: number) => {
    const fromSample = (sample.duration_ms ?? 0) / 1000;
    const fromPeaks = (getRowPeaks(sample.id)?.duration_ms ?? 0) / 1000;
    const duration = fromSample > 0 ? fromSample : fromPeaks;
    const start = duration > 0 ? fraction * duration : 0;
    skipPlayOnSelect.current = true;
    setFocusedId(sample.id);
    setSelectedIds(new Set([sample.id]));
    playheadStore.set(start);
    play(sample.id, start, null);
  });

  const onDetailToggleFavorite = useStableCallback(() => {
    if (focused) toggleFavorite(focused.id, !focused.favorite);
  });
  const onDetailAddTag = useStableCallback((tagId: number) => {
    if (!focused) return;
    const id = focused.id;
    void ipc
      .addSampleTag(id, tagId)
      .then(() => {
        patchFromServer([id]);
      })
      .catch(console.error);
  });
  const onDetailRemoveTag = useStableCallback((tagId: number) => {
    if (!focused) return;
    const id = focused.id;
    void ipc
      .removeSampleTag(id, tagId)
      .then(() => {
        patchFromServer([id]);
      })
      .catch(console.error);
  });
  const onDetailSeek = useStableCallback((secs: number) => {
    if (focusedId == null) return;
    const snapped = snapSecs(secs);
    const region = loopRegion(focused, selection);
    play(focusedId, snapped, region);
    playheadStore.set(snapped);
  });
  const onDetailSnapPointer = useStableCallback(snapSecs);
  const onDetailSelect = useStableCallback((next: Selection | null) => {
    const snapped = next ? { start: snapSecs(next.start), end: snapSecs(next.end) } : null;
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
  });
  const onDetailDragClip = useStableCallback(dragClip);
  const onSnapChange = useStableCallback((snap: AppSettings["snap"]) => {
    onSettingChange("snap", snap);
  });
  const onLoopChange = useStableCallback((on: boolean) => {
    onSettingChange("loop_preview", on);
  });
  const onGainChange = useStableCallback((db: number) => {
    onSettingChange("preview_gain_db", db);
  });
  const onRecheckPath = useStableCallback(reload);
  const onLocate = useStableCallback(() => {
    if (focused) void revealItemInDir(focused.parent_path).catch(console.error);
  });
  const onRemoveMissing = useStableCallback(() => {
    if (focused) setDialog({ kind: "removeMissing", sample: focused });
  });

  const selectFolderHint =
    !omni.folder &&
    !omni.text &&
    omni.tags.length === 0 &&
    omni.bpmMin == null &&
    omni.bpmMax == null &&
    !omni.key &&
    !favoritesOnly;

  return (
    <>
      <div className="library-layout">
        <FolderSidebar
          folders={folders}
          tags={tags}
          selectedPath={omni.folder}
          selectedTagPath={omni.tags[0] ?? null}
          onSelectFolder={onSelectFolder}
          onSelectTag={onSelectTag}
          onAddRoot={onAddRoot}
          onRemoveRoot={onRemoveRoot}
          onManageTags={onManageTags}
        />

        <main className="library-main">
          <OmniSearch
            value={omni}
            onChange={setOmni}
            folders={folders}
            halfDouble={settings.half_double_bpm}
            relativeKey={settings.relative_key}
            onToggleHalfDouble={onToggleHalfDouble}
            onToggleRelativeKey={onToggleRelativeKey}
            showWaveforms={settings.row_waveforms}
            onToggleWaveforms={onToggleWaveforms}
            favoritesOnly={favoritesOnly}
            onToggleFavoritesOnly={onToggleFavoritesOnly}
            hiddenColumns={hiddenColumns}
            onToggleColumn={onToggleColumn}
            columnLabels={columnLabels}
          />

          <SampleTable
            samples={samples}
            indexedCount={stats.samples}
            loading={samplesLoading}
            selectedIds={selectedIds}
            playingId={playingId}
            showWaveforms={settings.row_waveforms}
            coloredWaveforms={settings.colored_waveforms}
            hiddenColumns={hiddenColumns}
            columnWidths={columnWidths}
            columnOrder={columnOrder}
            sortColumn={settings.sort_column}
            sortDirection={settings.sort_direction}
            highlightText={omni.text}
            hoverPreviewHeld={hoverPreviewHeld}
            selectFolderHint={selectFolderHint}
            onSelect={onSelectRow}
            onHoverPreview={onHoverPreview}
            onToggleFavorite={onToggleFavoriteRow}
            onSort={onSort}
            onColumnWidthsChange={onColumnWidthsChange}
            onColumnOrderChange={onColumnOrderChange}
            onOpenMenu={onOpenMenu}
            onDragSelected={onDragSelected}
            onScrubRow={onScrubRow}
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
            playheadActive={playingId != null && playingId === focusedId}
            selection={selection}
            loopPreview={settings.loop_preview}
            gainDb={settings.preview_gain_db}
            onToggleFavorite={onDetailToggleFavorite}
            onAddTag={onDetailAddTag}
            onRemoveTag={onDetailRemoveTag}
            onSeek={onDetailSeek}
            snapPointer={onDetailSnapPointer}
            onSelect={onDetailSelect}
            clipReady={clipPath != null}
            onDragClip={onDetailDragClip}
            onSnapChange={onSnapChange}
            onLoopChange={onLoopChange}
            onGainChange={onGainChange}
            onRecheckPath={onRecheckPath}
            onLocate={onLocate}
            onRemoveMissing={onRemoveMissing}
          />
        </main>
      </div>

      <StatusBar
        rootCount={stats.roots}
        fileCount={stats.samples}
        shownCount={samples.length}
        filtered={filtered}
        statusText={statusText}
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
            const ids = menuTargets.map((row) => row.id);
            void Promise.all(ids.map((id) => ipc.setKey(id, key)))
              .then(() => {
                patchFromServer(ids);
              })
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
            const ids = selectedSamples.map((s) => s.id);
            void Promise.all(
              ids.map((id) => (next ? ipc.addSampleTag(id, tagId) : ipc.removeSampleTag(id, tagId))),
            )
              .then(() => {
                patchFromServer(ids);
              })
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
