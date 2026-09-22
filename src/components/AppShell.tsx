import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FirstLaunch } from "./FirstLaunch";
import { FolderSidebar, type FolderNode } from "./FolderSidebar";
import { OmniSearch, type OmniState } from "./OmniSearch";
import { SampleTable, type ContextAction, type SampleRow } from "./SampleTable";
import { StatusBar } from "./StatusBar";
import { TagManager } from "./TagManager";
import { TitleBar } from "./TitleBar";
import { WaveformCanvas, type PeakData } from "./WaveformCanvas";
import "./AppShell.css";

export type AppView = "library" | "settings" | "tags";

interface DbStats {
  roots: number;
  samples: number;
  tags: number;
  data_dir: string;
  clips_dir: string;
}

interface IndexProgress {
  root_id: number;
  scanned: number;
  indexed: number;
  skipped: number;
  current_path: string;
  done: boolean;
}

interface AnalysisProgress {
  sample_id: number;
  done: number;
  remaining: number;
}

interface CustomOpts {
  overwrite_tags: boolean;
  rerun_bpm: boolean;
  rerun_key: boolean;
  rerun_type: boolean;
}

type SortCol = "name" | "type" | "bpm" | "key" | "created_at" | "favorite";

const BPM_PRESETS: { min: number; max: number; labelKey: string }[] = [
  { min: 60, max: 150, labelKey: "bpmPreset_60_150" },
  { min: 68, max: 135, labelKey: "bpmPreset_68_135" },
  { min: 70, max: 180, labelKey: "bpmPreset_70_180" },
  { min: 90, max: 180, labelKey: "bpmPreset_90_180" },
  { min: 98, max: 195, labelKey: "bpmPreset_98_195" },
];

const emptyOmni = (): OmniState => ({
  text: "",
  folder: null,
  tags: [],
  bpmMin: null,
  bpmMax: null,
  key: null,
  halfDouble: false,
  relativeKey: false,
});

export function AppShell() {
  const { t } = useTranslation("common");
  const { t: ts } = useTranslation("settings");
  const { t: tl } = useTranslation("library");
  const [view, setView] = useState<AppView>("library");
  const [stats, setStats] = useState<DbStats>({
    roots: 0,
    samples: 0,
    tags: 0,
    data_dir: "",
    clips_dir: "",
  });
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<FolderNode | null>(null);
  const [indexStatus, setIndexStatus] = useState<string | undefined>();
  const [analysisStatus, setAnalysisStatus] = useState<string | undefined>();
  const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(() => new Set());
  const [analysisBar, setAnalysisBar] = useState<{ done: number; total: number } | null>(null);
  const [showWaveforms, setShowWaveforms] = useState(true);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [sortColumn, setSortColumn] = useState<SortCol>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | "clear">("asc");
  const [peaks, setPeaks] = useState<PeakData | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [loopPreview, setLoopPreview] = useState(true);
  const [playOnSelect, setPlayOnSelect] = useState(true);
  const [snap, setSnap] = useState<"None" | "1/4" | "1/8" | "1/16">("1/4");
  const shiftHeld = useRef(false);
  const [omni, setOmni] = useState<OmniState>(emptyOmni);
  const [customOpen, setCustomOpen] = useState(false);
  const [customOpts, setCustomOpts] = useState<CustomOpts>({
    overwrite_tags: false,
    rerun_bpm: true,
    rerun_key: true,
    rerun_type: true,
  });
  const [bpmMin, setBpmMin] = useState(70);
  const [bpmMax, setBpmMax] = useState(180);
  const [askIndexPaths, setAskIndexPaths] = useState<string[] | null>(null);
  const [newFileMode, setNewFileMode] = useState<"auto" | "ask">("auto");
  const [notifyAutoIndex, setNotifyAutoIndex] = useState(false);
  const [ignoreList, setIgnoreList] = useState<string[]>([]);
  const [outputDevices, setOutputDevices] = useState<
    { id: string; name: string; is_default: boolean }[]
  >([]);
  const [outputDevice, setOutputDevice] = useState("default");
  const [settingsPlayOnSelect, setSettingsPlayOnSelect] = useState(true);
  const [settingsLoopPreview, setSettingsLoopPreview] = useState(true);

  const refreshStats = useCallback(async () => {
    const [nextStats, tree] = await Promise.all([
      invoke<DbStats>("db_stats"),
      invoke<FolderNode[]>("folder_tree", { maxDepth: 6 }),
    ]);
    setStats(nextStats);
    setFolders(tree);
  }, []);

  const refreshSamples = useCallback(async () => {
    const rows = await invoke<SampleRow[]>("list_samples", {
      query: {
        folder_prefix: omni.folder,
        text: omni.text || null,
        tag_path: omni.tags[0] ?? null,
        tag_paths: omni.tags,
        bpm_min: omni.bpmMin,
        bpm_max: omni.bpmMax,
        key: omni.key,
        half_double: omni.halfDouble,
        relative_key: omni.relativeKey,
        favorites_only: favoritesOnly,
        sort_column: sortColumn,
        sort_direction: sortDirection,
        limit: 5000,
        offset: 0,
      },
    });
    setSamples(rows);
  }, [omni, sortColumn, sortDirection, favoritesOnly]);

  useEffect(() => {
    void refreshStats().catch(console.error);
  }, [refreshStats, view]);

  useEffect(() => {
    if (stats.roots > 0) {
      void refreshSamples().catch(console.error);
    }
  }, [refreshSamples, stats.roots]);

  useEffect(() => {
    void invoke<{
      play_on_select?: boolean;
      loop_preview?: boolean;
      half_double_bpm?: boolean;
      relative_key?: boolean;
      bpm_range_min?: number;
      bpm_range_max?: number;
      new_file_mode?: string;
      notify_auto_index?: boolean;
      ignore_list?: string[];
      output_device?: string;
    }>("get_settings").then((s) => {
      if (typeof s.play_on_select === "boolean") {
        setPlayOnSelect(s.play_on_select);
        setSettingsPlayOnSelect(s.play_on_select);
      }
      if (typeof s.loop_preview === "boolean") {
        setLoopPreview(s.loop_preview);
        setSettingsLoopPreview(s.loop_preview);
      }
      if (typeof s.bpm_range_min === "number") setBpmMin(s.bpm_range_min);
      if (typeof s.bpm_range_max === "number") setBpmMax(s.bpm_range_max);
      if (s.new_file_mode === "ask" || s.new_file_mode === "auto") setNewFileMode(s.new_file_mode);
      if (typeof s.notify_auto_index === "boolean") setNotifyAutoIndex(s.notify_auto_index);
      if (Array.isArray(s.ignore_list)) {
        setIgnoreList(s.ignore_list.filter((x): x is string => typeof x === "string"));
      }
      if (typeof s.output_device === "string") setOutputDevice(s.output_device);
      setOmni((prev) => ({
        ...prev,
        halfDouble: typeof s.half_double_bpm === "boolean" ? s.half_double_bpm : prev.halfDouble,
        relativeKey: typeof s.relative_key === "boolean" ? s.relative_key : prev.relativeKey,
      }));
    });
    void invoke<{ id: string; name: string; is_default: boolean }[]>("list_output_devices")
      .then(setOutputDevices)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (focusedId == null) {
      setPeaks(null);
      setSelection(null);
      return;
    }
    const row = samples.find((s) => s.id === focusedId);
    if (row?.missing) {
      setPeaks(null);
      setSelection(null);
      return;
    }
    void invoke<PeakData>("get_peaks", { sampleId: focusedId })
      .then(setPeaks)
      .catch(() => void setPeaks(null));
    if (playOnSelect) {
      void invoke("play_sample", { sampleId: focusedId, startSecs: null }).catch(console.error);
    }
  }, [focusedId, playOnSelect, samples]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          void invoke<boolean>("redo_meta").then((ok) => {
            if (ok) void refreshSamples();
          });
        } else {
          void invoke<boolean>("undo_meta").then((ok) => {
            if (ok) void refreshSamples();
          });
        }
        return;
      }
      if (e.key === "Enter" && focusedId != null) {
        e.preventDefault();
        void invoke("play_sample", { sampleId: focusedId, startSecs: 0 });
      } else if (e.key === " ") {
        e.preventDefault();
        void invoke("pause_playback").catch(() => invoke("resume_playback"));
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (samples.length === 0) return;
        const idx = focusedId == null ? 0 : samples.findIndex((s) => s.id === focusedId);
        const next =
          e.key === "ArrowDown"
            ? Math.min(samples.length - 1, Math.max(0, idx) + 1)
            : Math.max(0, (idx < 0 ? 0 : idx) - 1);
        const row = samples[next];
        if (!row) return;
        const id = row.id;
        setFocusedId(id);
        setSelectedIds(new Set([id]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => void window.removeEventListener("keydown", onKey);
  }, [focusedId, samples, refreshSamples]);

  useEffect(() => {
    let unlistenIndex: (() => void) | undefined;
    let unlistenAnalysis: (() => void) | undefined;
    let unlistenQueue: (() => void) | undefined;
    let unlistenLibrary: (() => void) | undefined;
    let unlistenAsk: (() => void) | undefined;
    void listen<IndexProgress>("index-progress", (event) => {
      const p = event.payload;
      if (p.done) {
        setIndexStatus(undefined);
        void refreshStats();
        void refreshSamples();
      } else {
        setIndexStatus(`Indexing ${p.scanned}…`);
      }
    }).then((fn) => {
      unlistenIndex = fn;
    });
    void listen<number[]>("analysis-queue", (event) => {
      const ids = event.payload;
      setAnalyzingIds(new Set(ids));
      setAnalysisBar({ done: 0, total: ids.length });
      setAnalysisStatus(t("statusAnalyzing"));
    }).then((fn) => {
      unlistenQueue = fn;
    });
    void listen<AnalysisProgress>("analysis-progress", (event) => {
      const p = event.payload;
      const total = p.done + p.remaining;
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(p.sample_id);
        return next;
      });
      if (p.remaining === 0) {
        setAnalysisStatus(undefined);
        setAnalysisBar(null);
        setAnalyzingIds(new Set());
        void refreshSamples();
        void refreshStats();
      } else {
        setAnalysisBar({ done: p.done, total });
        setAnalysisStatus(t("statusAnalyzingProgress", { done: p.done, total }));
      }
    }).then((fn) => {
      unlistenAnalysis = fn;
    });
    void listen("library-changed", () => {
      void refreshStats();
      void refreshSamples();
    }).then((fn) => {
      unlistenLibrary = fn;
    });
    void listen<{ paths: string[] }>("ask-index", (event) => {
      setAskIndexPaths((prev) => {
        const next = new Set([...(prev ?? []), ...event.payload.paths]);
        return Array.from(next);
      });
    }).then((fn) => {
      unlistenAsk = fn;
    });
    return () => {
      unlistenIndex?.();
      unlistenAnalysis?.();
      unlistenQueue?.();
      unlistenLibrary?.();
      unlistenAsk?.();
    };
  }, [refreshSamples, refreshStats, t]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const snapSecs = useCallback(
    (secs: number, bpm: number | null | undefined) => {
      if (shiftHeld.current || snap === "None" || bpm == null || bpm <= 0) return secs;
      const div = snap === "1/4" ? 1 : snap === "1/8" ? 2 : 4;
      const beat = 60 / bpm;
      const grid = beat / div;
      return Math.round(secs / grid) * grid;
    },
    [snap],
  );

  const addFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: tl("addFolder"),
    });
    if (!selected || Array.isArray(selected)) return;
    setIndexStatus("Indexing…");
    await invoke("add_root", { path: selected });
    await refreshStats();
  }, [refreshStats, tl]);

  const removeSelectedRoot = useCallback(async () => {
    if (!confirmRemove?.is_root) return;
    await invoke("remove_root", { rootId: confirmRemove.root_id });
    setConfirmRemove(null);
    setSelectedFolder(null);
    await refreshStats();
    await refreshSamples();
  }, [confirmRemove, refreshSamples, refreshStats]);

  const onSelectRow = (id: number, e: React.MouseEvent) => {
    setFocusedId(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e.metaKey || e.ctrlKey) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      if (e.shiftKey && focusedId != null) {
        const a = samples.findIndex((s) => s.id === focusedId);
        const b = samples.findIndex((s) => s.id === id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) {
            const s = samples[i];
            if (s) next.add(s.id);
          }
          return next;
        }
      }
      return new Set([id]);
    });
  };

  const onSort = (col: SortCol) => {
    if (sortColumn !== col) {
      setSortColumn(col);
      setSortDirection("asc");
      return;
    }
    setSortDirection((d) => (d === "asc" ? "desc" : d === "desc" ? "clear" : "asc"));
    if (sortDirection === "desc") setSortColumn("name");
  };

  const persistOmniToggle = (key: "half_double_bpm" | "relative_key", value: boolean) => {
    void invoke("set_setting", { key, value });
  };

  const focused = samples.find((s) => s.id === focusedId) ?? null;
  const isEmpty = stats.roots === 0;

  const dragSelectedFiles = useCallback(async () => {
    const paths = samples
      .filter((s) => selectedIds.has(s.id) && !s.missing)
      .map((s) => s.path);
    if (paths.length === 0) return;
    await invoke("start_drag_files", { paths });
  }, [samples, selectedIds]);

  const dragSelectionClip = useCallback(async () => {
    if (focusedId == null || !selection) return;
    const path = await invoke<string>("render_jit_clip", {
      sampleId: focusedId,
      startSecs: selection.start,
      endSecs: selection.end,
    });
    await invoke("start_drag_files", { paths: [path] });
  }, [focusedId, selection]);

  const runNormalAnalyze = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setAnalysisStatus(t("statusAnalyzing"));
    await invoke("analyze_samples", { ids, custom: null });
  }, [selectedIds, t]);

  const runCustomAnalyze = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setCustomOpen(false);
    setAnalysisStatus(t("statusAnalyzing"));
    await invoke("analyze_samples", { ids, custom: customOpts });
  }, [selectedIds, customOpts, t]);

  const setBpmPreset = (min: number, max: number) => {
    setBpmMin(min);
    setBpmMax(max);
    void invoke("set_setting", { key: "bpm_range_min", value: min });
    void invoke("set_setting", { key: "bpm_range_max", value: max });
  };

  const onContextAction = useCallback(
    (action: ContextAction, sample: SampleRow) => {
      switch (action) {
        case "open":
          void openPath(sample.path).catch(console.error);
          break;
        case "favorite":
          void invoke("set_sample_favorite", {
            id: sample.id,
            favorite: !sample.favorite,
          }).then(refreshSamples);
          break;
        case "reveal":
          void revealItemInDir(sample.path).catch(console.error);
          break;
        case "copyPath":
          void navigator.clipboard.writeText(sample.path);
          break;
        case "copyFilename":
          void navigator.clipboard.writeText(sample.filename);
          break;
        case "reanalyze":
          setAnalysisStatus(t("statusAnalyzing"));
          void invoke("analyze_samples", { ids: [sample.id], custom: null });
          break;
        case "showParent":
          setOmni((prev) => ({ ...prev, folder: sample.parent_path }));
          setSelectedFolder(sample.parent_path);
          break;
        case "removeMissing":
          void invoke("remove_sample", { id: sample.id }).then(() => {
            setFocusedId(null);
            setSelectedIds(new Set());
            void refreshSamples();
            void refreshStats();
          });
          break;
      }
    },
    [refreshSamples, refreshStats, t],
  );

  const respondAsk = useCallback(
    async (index: boolean, all: boolean) => {
      if (!askIndexPaths || askIndexPaths.length === 0) return;
      const paths = all ? askIndexPaths : askIndexPaths.slice(0, 1);
      await invoke("respond_ask_index", { paths, index });
      setAskIndexPaths((prev) => {
        if (!prev) return null;
        const remaining = prev.filter((p) => !paths.includes(p));
        return remaining.length ? remaining : null;
      });
      if (index) {
        void refreshSamples();
        void refreshStats();
      }
    },
    [askIndexPaths, refreshSamples, refreshStats],
  );

  const statusText = analysisStatus ?? indexStatus;

  return (
    <div className="app-shell">
      <TitleBar onSettings={() => void setView("settings")} onTags={() => void setView("tags")} />

      {view === "library" && isEmpty ? (
        <FirstLaunch onAddFolder={() => void addFolder()} onPreferences={() => void setView("settings")} />
      ) : null}

      {view === "library" && !isEmpty ? (
        <div className="library-layout">
          <FolderSidebar
            nodes={folders}
            selectedPath={selectedFolder}
            onSelect={(path) => {
              setSelectedFolder(path);
              setOmni((prev) => ({ ...prev, folder: path }));
              setSelectedIds(new Set());
              setFocusedId(null);
            }}
            onAddRoot={() => void addFolder()}
          />
          <main className="library-main">
            <OmniSearch
              value={omni}
              onChange={(next) => {
                setOmni(next);
                if (next.folder !== omni.folder) {
                  setSelectedFolder(next.folder);
                }
              }}
              onToggleHalfDouble={() => {
                setOmni((prev) => {
                  const next = !prev.halfDouble;
                  persistOmniToggle("half_double_bpm", next);
                  return { ...prev, halfDouble: next };
                });
              }}
              onToggleRelativeKey={() => {
                setOmni((prev) => {
                  const next = !prev.relativeKey;
                  persistOmniToggle("relative_key", next);
                  return { ...prev, relativeKey: next };
                });
              }}
              showWaveforms={showWaveforms}
              onToggleWaveforms={() => void setShowWaveforms((v) => !v)}
              favoritesOnly={favoritesOnly}
              onToggleFavoritesOnly={() => void setFavoritesOnly((v) => !v)}
            />
            <div className="library-toolbar">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={selectedIds.size === 0}
                onClick={() => void dragSelectedFiles().catch(console.error)}
              >
                {tl("dragFiles")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={selectedIds.size === 0}
                onClick={() => void runNormalAnalyze().catch(console.error)}
              >
                {tl("analyzeSelected")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={selectedIds.size < 1}
                onClick={() => void setCustomOpen(true)}
              >
                {tl("customAnalysis")}
              </button>
            </div>
            <SampleTable
              samples={samples}
              selectedIds={selectedIds}
              focusedId={focusedId}
              analyzingIds={analyzingIds}
              showWaveforms={showWaveforms}
              sortColumn={sortColumn}
              sortDirection={sortDirection === "clear" ? "clear" : sortDirection}
              highlightText={omni.text}
              onSelect={onSelectRow}
              onToggleFavorite={(id, favorite) => {
                void invoke("set_sample_favorite", { id, favorite }).then(refreshSamples);
              }}
              onSort={onSort}
              onContextAction={onContextAction}
            />
            <div className="detail-pane">
              {focused ? (
                <>
                  {focused.missing ? (
                    <div className="missing-banner">
                      <p>{tl("missingBanner")}</p>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() =>
                          void invoke("remove_sample", { id: focused.id }).then(() => {
                            setFocusedId(null);
                            void refreshSamples();
                            void refreshStats();
                          })
                        }
                      >
                        {tl("removeMissingConfirm")}
                      </button>
                    </div>
                  ) : null}
                  <div className="detail-header">
                    <div>
                      <div className="detail-title">{focused.filename}</div>
                      <div className="detail-path mono">{focused.path}</div>
                      {focused.tags.length > 0 ? (
                        <div className="detail-tags">
                          {focused.tags.map((tag) => (
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
                      ) : null}
                    </div>
                    <div className="detail-transport">
                      <label className="snap-select">
                        <span>{tl("snap")}</span>
                        <select
                          value={snap}
                          onChange={(e) =>
                            void setSnap(e.target.value as "None" | "1/4" | "1/8" | "1/16")
                          }
                        >
                          <option value="None">None</option>
                          <option value="1/4">1/4</option>
                          <option value="1/8">1/8</option>
                          <option value="1/16">1/16</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        className={`btn ${loopPreview ? "btn-primary" : "btn-secondary"}`}
                        onClick={() => {
                          const next = !loopPreview;
                          setLoopPreview(next);
                          void invoke("set_loop_preview", { on: next });
                        }}
                      >
                        {tl("loopPreview")}
                      </button>
                      {selection && !focused.missing ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void dragSelectionClip().catch(console.error)}
                        >
                          {tl("dragClip")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {!focused.missing ? (
                    <WaveformCanvas
                      peaks={peaks}
                      selection={selection}
                      onSeek={(secs) => {
                        if (focusedId != null) {
                          const snapped = snapSecs(secs, focused.bpm);
                          void invoke("play_sample", {
                            sampleId: focusedId,
                            startSecs: snapped,
                          });
                        }
                      }}
                      onSelectRegion={(a, b) => {
                        const s = snapSecs(Math.min(a, b), focused.bpm);
                        const e = snapSecs(Math.max(a, b), focused.bpm);
                        setSelection({ start: s, end: e });
                      }}
                    />
                  ) : null}
                </>
              ) : (
                <div className="muted">Select a sample</div>
              )}
            </div>
          </main>
        </div>
      ) : null}

      {view === "settings" ? (
        <div className="overlay-panel">
          <div className="overlay-card settings-card">
            <h2>{ts("title")}</h2>
            <p className="muted">{ts("changesApply")}</p>

            <div className="settings-block">
              <div className="settings-label">{ts("navPlayback")}</div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settingsPlayOnSelect}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setSettingsPlayOnSelect(v);
                    setPlayOnSelect(v);
                    void invoke("set_setting", { key: "play_on_select", value: v });
                  }}
                />
                {ts("playOnSelect")}
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settingsLoopPreview}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setSettingsLoopPreview(v);
                    setLoopPreview(v);
                    void invoke("set_loop_preview", { on: v });
                  }}
                />
                {ts("loopPreview")}
              </label>
              <div className="settings-label">{ts("outputDevice")}</div>
              <select
                className="settings-select"
                value={outputDevice}
                onChange={(e) => {
                  const id = e.target.value;
                  setOutputDevice(id);
                  void invoke("set_output_device", { id });
                }}
              >
                {outputDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-block">
              <div className="settings-label">{ts("bpmRange")}</div>
              <p className="muted">{ts("bpmRangeHint")}</p>
              <div className="settings-preset-row">
                {BPM_PRESETS.map((p) => {
                  const active = bpmMin === p.min && bpmMax === p.max;
                  return (
                    <button
                      key={p.labelKey}
                      type="button"
                      className={`btn ${active ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => void setBpmPreset(p.min, p.max)}
                    >
                      {ts(p.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-label">{ts("newFiles")}</div>
              <p className="muted">{ts("newFilesHint")}</p>
              <div className="settings-preset-row">
                <button
                  type="button"
                  className={`btn ${newFileMode === "auto" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => {
                    setNewFileMode("auto");
                    void invoke("set_setting", { key: "new_file_mode", value: "auto" });
                  }}
                >
                  {ts("autoIndex")}
                </button>
                <button
                  type="button"
                  className={`btn ${newFileMode === "ask" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => {
                    setNewFileMode("ask");
                    void invoke("set_setting", { key: "new_file_mode", value: "ask" });
                  }}
                >
                  {ts("askFirst")}
                </button>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={notifyAutoIndex}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setNotifyAutoIndex(v);
                    void invoke("set_setting", { key: "notify_auto_index", value: v });
                  }}
                />
                {ts("notifyAutoIndex")}
              </label>
            </div>

            <div className="settings-block">
              <div className="settings-label">{ts("ignoreList")}</div>
              <p className="muted">{ts("ignoreListHint")}</p>
              <ul className="ignore-list mono">
                {ignoreList.map((pat) => (
                  <li key={pat}>{pat}</li>
                ))}
              </ul>
            </div>

            <div className="settings-block">
              <div className="settings-label">{ts("holdHover")}</div>
              <p className="muted">{ts("holdHoverHint")}</p>
              <p className="muted">{ts("holdHoverUnbound")}</p>
            </div>

            {stats.clips_dir ? (
              <div className="settings-block">
                <div className="settings-label">{ts("jitCache")}</div>
                <p className="muted mono">{stats.clips_dir}</p>
              </div>
            ) : null}

            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  void invoke("purge_missing").then(() => {
                    void refreshSamples();
                    void refreshStats();
                  })
                }
              >
                {ts("purgeMissing")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void invoke("clear_jit_cache").catch(console.error)}
              >
                {ts("clearCache")}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void setView("library")}>
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {view === "tags" ? <TagManager onClose={() => void setView("library")} /> : null}

      {confirmRemove ? (
        <div className="overlay-panel modal">
          <div className="overlay-card">
            <h2>{tl("removeRootTitle")}</h2>
            <p className="muted">{tl("removeRootBody")}</p>
            <p className="muted mono">{confirmRemove.path}</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => void setConfirmRemove(null)}>
                {t("cancel")}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void removeSelectedRoot()}>
                {tl("removeRootConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {customOpen ? (
        <div className="overlay-panel modal">
          <div className="overlay-card">
            <h2>{ts("customAnalysis")}</h2>
            <p className="muted">{ts("analyzeN", { count: selectedIds.size })}</p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={customOpts.overwrite_tags}
                onChange={(e) =>
                  void setCustomOpts((o) => ({ ...o, overwrite_tags: e.target.checked }))
                }
              />
              {ts("overwriteTags")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={customOpts.rerun_bpm}
                onChange={(e) => void setCustomOpts((o) => ({ ...o, rerun_bpm: e.target.checked }))}
              />
              {ts("rerunBpm")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={customOpts.rerun_key}
                onChange={(e) => void setCustomOpts((o) => ({ ...o, rerun_key: e.target.checked }))}
              />
              {ts("rerunKey")}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={customOpts.rerun_type}
                onChange={(e) => void setCustomOpts((o) => ({ ...o, rerun_type: e.target.checked }))}
              />
              {ts("rerunType")}
            </label>
            <div className="settings-block">
              <div className="settings-label">{ts("bpmRange")}</div>
              <div className="settings-preset-row">
                {BPM_PRESETS.map((p) => {
                  const active = bpmMin === p.min && bpmMax === p.max;
                  return (
                    <button
                      key={p.labelKey}
                      type="button"
                      className={`btn ${active ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => void setBpmPreset(p.min, p.max)}
                    >
                      {ts(p.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => void setCustomOpen(false)}>
                {t("cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void runCustomAnalyze().catch(console.error)}
              >
                {ts("analyzeN", { count: selectedIds.size })}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {askIndexPaths && askIndexPaths.length > 0 ? (
        <div className="overlay-panel modal">
          <div className="overlay-card">
            <h2>{tl("askIndexTitle")}</h2>
            <p className="muted mono">{askIndexPaths[0]}</p>
            {askIndexPaths.length > 1 ? (
              <p className="muted">+{askIndexPaths.length - 1} more</p>
            ) : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void respondAsk(false, false)}
              >
                {tl("askSkip")}
              </button>
              {askIndexPaths.length > 1 ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void respondAsk(false, true)}
                >
                  {tl("askSkipAll")}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void respondAsk(true, false)}
              >
                {tl("askIndex")}
              </button>
              {askIndexPaths.length > 1 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void respondAsk(true, true)}
                >
                  {tl("askIndexAll")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <StatusBar
        rootCount={stats.roots}
        fileCount={stats.samples}
        shownCount={isEmpty ? undefined : samples.length}
        statusText={statusText}
        analysis={analysisBar}
      />
    </div>
  );
}
