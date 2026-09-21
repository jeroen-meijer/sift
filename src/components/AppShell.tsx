import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FirstLaunch } from "./FirstLaunch";
import { FolderSidebar, type FolderNode } from "./FolderSidebar";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
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

  const refresh = useCallback(async () => {
    const [nextStats, tree] = await Promise.all([
      invoke<DbStats>("db_stats"),
      invoke<FolderNode[]>("folder_tree", { maxDepth: 6 }),
    ]);
    setStats(nextStats);
    setFolders(tree);
  }, []);

  useEffect(() => {
    void refresh().catch((err) => console.error(err));
  }, [refresh, view]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<IndexProgress>("index-progress", (event) => {
      const p = event.payload;
      if (p.done) {
        setIndexStatus(undefined);
        void refresh();
      } else {
        setIndexStatus(`Indexing ${p.scanned}…`);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  const addFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: tl("addFolder"),
    });
    if (!selected || Array.isArray(selected)) return;
    setIndexStatus("Indexing…");
    await invoke("add_root", { path: selected });
    await refresh();
  }, [refresh, tl]);

  const removeSelectedRoot = useCallback(async () => {
    if (!confirmRemove?.is_root) return;
    await invoke("remove_root", { rootId: confirmRemove.root_id });
    setConfirmRemove(null);
    setSelectedFolder(null);
    await refresh();
  }, [confirmRemove, refresh]);

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
            onSelect={setSelectedFolder}
            onAddRoot={() => void addFolder()}
          />
          <main className="library-main">
            <div className="library-placeholder">
              {selectedFolder ?? t("appName")}
              <div className="muted" style={{ marginTop: 8 }}>
                {stats.samples} samples indexed
              </div>
              {selectedFolder && folders.find((f) => f.path === selectedFolder)?.is_root ? (
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      const root = folders.find((f) => f.path === selectedFolder);
                      if (root) {
                        setIndexStatus("Indexing…");
                        void invoke("reindex_root", { rootId: root.root_id });
                      }
                    }}
                  >
                    Re-index
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    style={{ marginLeft: 8 }}
                    onClick={() =>
                      setConfirmRemove(folders.find((f) => f.path === selectedFolder) ?? null)
                    }
                  >
                    {tl("removeRootConfirm")}
                  </button>
                </div>
              ) : null}
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
