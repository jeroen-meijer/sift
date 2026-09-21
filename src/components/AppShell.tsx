import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FirstLaunch } from "./FirstLaunch";
import { FolderSidebar, type FolderNode } from "./FolderSidebar";
import { SampleTable, type SampleRow } from "./SampleTable";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { WaveformCanvas, type PeakData } from "./WaveformCanvas";
import "./AppShell.css";

export type AppView = "library" | "settings" | "tags";

type DbStats = {
  roots: number;
  samples: number;
  tags: number;
  data_dir: string;
  clips_dir: string;
};

type IndexProgress = {
  root_id: number;
  scanned: number;
  indexed: number;
  skipped: number;
  current_path: string;
  done: boolean;
};

type SortCol = "name" | "type" | "bpm" | "key" | "created_at" | "favorite";

export function AppShell() {
  const { t } = useTranslation("common");
  const { t: ts } = useTranslation("settings");
  const { t: tt } = useTranslation("tags");
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
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [sortColumn, setSortColumn] = useState<SortCol>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | "clear">("asc");
  const [peaks, setPeaks] = useState<PeakData | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [loopPreview, setLoopPreview] = useState(true);
  const [playOnSelect, setPlayOnSelect] = useState(true);

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
        folder_prefix: selectedFolder,
        favorites_only: false,
        sort_column: sortColumn,
        sort_direction: sortDirection,
        limit: 5000,
        offset: 0,
      },
    });
    setSamples(rows);
  }, [selectedFolder, sortColumn, sortDirection]);

  useEffect(() => {
    void refreshStats().catch(console.error);
  }, [refreshStats, view]);

  useEffect(() => {
    if (stats.roots > 0) {
      void refreshSamples().catch(console.error);
    }
  }, [refreshSamples, stats.roots]);

  useEffect(() => {
    void invoke<{ play_on_select?: boolean; loop_preview?: boolean }>("get_settings").then((s) => {
      if (typeof s.play_on_select === "boolean") setPlayOnSelect(s.play_on_select);
      if (typeof s.loop_preview === "boolean") setLoopPreview(s.loop_preview);
    });
  }, []);

  useEffect(() => {
    if (focusedId == null) {
      setPeaks(null);
      setSelection(null);
      return;
    }
    void invoke<PeakData>("get_peaks", { sampleId: focusedId })
      .then(setPeaks)
      .catch(() => setPeaks(null));
    if (playOnSelect) {
      void invoke("play_sample", { sampleId: focusedId, startSecs: null }).catch(console.error);
    }
  }, [focusedId, playOnSelect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
        const id = samples[next].id;
        setFocusedId(id);
        setSelectedIds(new Set([id]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedId, samples]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
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
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [refreshSamples, refreshStats]);

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
          for (let i = lo; i <= hi; i++) next.add(samples[i].id);
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

  const focused = samples.find((s) => s.id === focusedId) ?? null;
  const isEmpty = stats.roots === 0;

  return (
    <div className="app-shell">
      <TitleBar onSettings={() => setView("settings")} onTags={() => setView("tags")} />

      {view === "library" && isEmpty ? (
        <FirstLaunch onAddFolder={() => void addFolder()} onPreferences={() => setView("settings")} />
      ) : null}

      {view === "library" && !isEmpty ? (
        <div className="library-layout">
          <FolderSidebar
            nodes={folders}
            selectedPath={selectedFolder}
            onSelect={(path) => {
              setSelectedFolder(path);
              setSelectedIds(new Set());
              setFocusedId(null);
            }}
            onAddRoot={() => void addFolder()}
          />
          <main className="library-main">
            <SampleTable
              samples={samples}
              selectedIds={selectedIds}
              focusedId={focusedId}
              sortColumn={sortColumn}
              sortDirection={sortDirection === "clear" ? "clear" : sortDirection}
              onSelect={onSelectRow}
              onToggleFavorite={(id, favorite) => {
                void invoke("set_sample_favorite", { id, favorite }).then(refreshSamples);
              }}
              onSort={onSort}
            />
            <div className="detail-pane">
              {focused ? (
                <>
                  <div className="detail-header">
                    <div>
                      <div className="detail-title">{focused.filename}</div>
                      <div className="detail-path mono">{focused.path}</div>
                    </div>
                    <div className="detail-transport">
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
                    </div>
                  </div>
                  <WaveformCanvas
                    peaks={peaks}
                    selection={selection}
                    onSeek={(secs) => {
                      if (focusedId != null) {
                        void invoke("play_sample", { sampleId: focusedId, startSecs: secs });
                      }
                    }}
                    onSelectRegion={(a, b) =>
                      setSelection({ start: Math.min(a, b), end: Math.max(a, b) })
                    }
                  />
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
          <div className="overlay-card">
            <h2>{ts("title")}</h2>
            <p className="muted">{ts("changesApply")}</p>
            {stats.clips_dir ? (
              <p className="muted mono">
                {ts("jitCache")}: {stats.clips_dir}
              </p>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={() => setView("library")}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      {view === "tags" ? (
        <div className="overlay-panel">
          <div className="overlay-card">
            <h2>{tt("title")}</h2>
            <p className="muted">{stats.tags} tags seeded</p>
            <button type="button" className="btn btn-secondary" onClick={() => setView("library")}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      {confirmRemove ? (
        <div className="overlay-panel modal">
          <div className="overlay-card">
            <h2>{tl("removeRootTitle")}</h2>
            <p className="muted">{tl("removeRootBody")}</p>
            <p className="muted mono">{confirmRemove.path}</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmRemove(null)}>
                {t("cancel")}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void removeSelectedRoot()}>
                {tl("removeRootConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <StatusBar rootCount={stats.roots} fileCount={stats.samples} statusText={indexStatus} />
    </div>
  );
}
