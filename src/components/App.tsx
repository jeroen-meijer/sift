import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { keys, matchesBinding } from "../lib/bindings";
import {
  ipc,
  type AnalysisProgress,
  type DbStats,
  type FolderNode,
  type LibraryChangedPayload,
  type OutputDevice,
  type TagNode,
} from "../lib/ipc";
import { analysisStore, rowChangesStore } from "../lib/liveStores";
import { invalidateRowPeaks } from "../lib/rowPeaks";
import { loadLibrary } from "../lib/loadLibrary";
import { revealMainWindow } from "../lib/revealWindow";
import { shellMode } from "../lib/shellMode";
import { useSettings } from "../lib/useSettings";
import { bootMark, warmProfile } from "../lib/profile";
import { applyTheme } from "../theme";
import { groupByFolder } from "../lib/askIndex";
import { AskIndexToast } from "./AskIndexToast";
import { FirstLaunch } from "./FirstLaunch";
import { LibraryView } from "./LibraryView";
import { SettingsView } from "./SettingsView";
import { StatusBar } from "./StatusBar";
import { TagManagerView } from "./TagManagerView";
import { TitleBar } from "./TitleBar";
import { UpdateAvailableDialog } from "./dialogs/UpdateAvailableDialog";
import { checkForAppUpdate, type AvailableUpdate } from "../lib/updates";
import "../styles/base.css";
import "../ui/ui.css";
import "./shell.css";
import "./library.css";
import "./detail.css";
import "./views.css";

type View = "library" | "settings" | "tags";

/** Analyze progress re-renders at most this often. */
const PROGRESS_THROTTLE_MS = 500;
/** Row-level library changes refresh the status bar counts at most this often. */
const STATS_MIN_INTERVAL_MS = 10_000;

const EMPTY_STATS: DbStats = {
  roots: 0,
  samples: 0,
  missing: 0,
  tags: 0,
  data_dir: "",
  clips_dir: "",
  clips_bytes: 0,
};

export function App() {
  const { t: tl } = useTranslation("library");
  const { settings, set: setSetting, loaded } = useSettings();

  const [view, setView] = useState<View>("library");
  /** null until the first db_stats round-trip. Not the same as zero roots. */
  const [stats, setStats] = useState<DbStats | null>(null);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [tags, setTags] = useState<TagNode[]>([]);
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  const [askPaths, setAskPaths] = useState<string[]>([]);
  const [launchUpdate, setLaunchUpdate] = useState<AvailableUpdate | null>(null);

  const mode = shellMode(loaded, stats);

  useLayoutEffect(() => {
    if (!loaded) return;
    applyTheme(settings.theme);
    bootMark("fe.theme_applied", settings.theme);
  }, [loaded, settings.theme]);

  /* Window starts hidden (tauri.conf visible:false). Show after shellMode leaves boot. */
  useLayoutEffect(() => {
    if (mode === "boot") return;
    bootMark("fe.ready", `mode=${mode}`);
    void revealMainWindow();
  }, [mode]);

  useEffect(() => {
    void warmProfile();
  }, []);

  /* After the shell leaves boot: check for updates (no-op in dev / offline). */
  useEffect(() => {
    if (mode === "boot") return;
    let cancelled = false;
    void checkForAppUpdate().then((outcome) => {
      if (cancelled || outcome.kind !== "available") return;
      setLaunchUpdate(outcome.available);
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const refreshLibrary = useCallback(() => {
    void loadLibrary({
      setStats,
      setFolders,
      setTags,
    }).catch((err: unknown) => {
      console.error(err);
      /* Still leave boot so a failed load can show first-run or last known stats. */
      setStats((prev) => prev ?? EMPTY_STATS);
      bootMark("fe.library_refresh_failed", "");
    });
  }, []);

  useEffect(() => {
    refreshLibrary();
    void ipc.listOutputDevices().then(setOutputDevices).catch(console.error);
  }, [refreshLibrary]);

  /* Preferences shortcut; Esc is handled inside the settings dialog. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesBinding(e, keys.preferences)) return;
      e.preventDefault();
      setView((current) => (current === "settings" ? "library" : "settings"));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /* Backend events: indexing, analysis, watcher. */
  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    let bumpTimer: ReturnType<typeof setTimeout> | undefined;
    /** Structural change: refetch stats, tree, tags and the list. */
    const bump = () => {
      if (bumpTimer) clearTimeout(bumpTimer);
      bumpTimer = setTimeout(() => {
        refreshLibrary();
        setRefreshToken((n) => n + 1);
      }, 150);
    };

    /* db_stats only feeds counts in the status bar; refresh it at most every 10 s. */
    let lastStatsAt = 0;
    let statsTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshStatsSoon = () => {
      if (statsTimer) return;
      const wait = Math.max(0, lastStatsAt + STATS_MIN_INTERVAL_MS - Date.now());
      statsTimer = setTimeout(() => {
        statsTimer = undefined;
        lastStatsAt = Date.now();
        void ipc.dbStats().then(setStats).catch(console.error);
      }, wait);
    };

    /* Progress arrives several times a second; the bar needs at most 2 updates a second. */
    let pendingProgress: AnalysisProgress | null = null;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    const applyProgress = (payload: AnalysisProgress) => {
      analysisStore.set({
        bar: payload.remaining === 0 ? null : { done: payload.done, total: payload.total },
        activeIds: payload.remaining === 0 ? new Set() : new Set(payload.active_ids),
      });
    };

    void listen<{ total: number }>("analysis-queue", ({ payload }) => {
      analysisStore.set({ bar: { done: 0, total: payload.total }, activeIds: new Set() });
    }).then((fn) => unlisteners.push(fn));

    void listen<AnalysisProgress>("analysis-progress", ({ payload }) => {
      if (payload.remaining === 0) {
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = undefined;
        pendingProgress = null;
        applyProgress(payload);
        return;
      }
      pendingProgress = payload;
      if (progressTimer) return;
      progressTimer = setTimeout(() => {
        progressTimer = undefined;
        if (pendingProgress) applyProgress(pendingProgress);
        pendingProgress = null;
      }, PROGRESS_THROTTLE_MS);
    }).then((fn) => unlisteners.push(fn));

    void listen<LibraryChangedPayload>("library-changed", ({ payload }) => {
      if (payload.structural) {
        bump();
        return;
      }
      if (payload.sample_ids.length === 0) return;
      /* Analysis results or availability: patch rows in place, keep the tree. */
      invalidateRowPeaks(payload.sample_ids);
      const prev = rowChangesStore.get();
      rowChangesStore.set({ seq: prev.seq + 1, ids: payload.sample_ids });
      refreshStatsSoon();
    }).then((fn) => unlisteners.push(fn));

    void listen<{ paths: string[] }>("ask-index", ({ payload }) => {
      setAskPaths((prev) => [...new Set([...prev, ...payload.paths])]);
    }).then((fn) => unlisteners.push(fn));

    return () => {
      if (bumpTimer) clearTimeout(bumpTimer);
      if (statsTimer) clearTimeout(statsTimer);
      if (progressTimer) clearTimeout(progressTimer);
      for (const off of unlisteners) off();
    };
  }, [refreshLibrary]);

  const onAnalysisStart = useCallback(() => {
    const cur = analysisStore.get();
    if (!cur.bar) analysisStore.set({ bar: { done: 0, total: 1 }, activeIds: cur.activeIds });
  }, []);

  const addRoot = useCallback(() => {
    void open({ directory: true, multiple: false, title: tl("addFolder") })
      .then((selected) => {
        if (typeof selected !== "string") return;
        return ipc.addRoot(selected).then(refreshLibrary);
      })
      .catch(console.error);
  }, [refreshLibrary, tl]);

  const respondAsk = useCallback(
    (paths: string[], index: boolean) => {
      void ipc
        .respondAskIndex(paths, index)
        .then(() => {
          setAskPaths((prev) => prev.filter((p) => !paths.includes(p)));
          if (index) {
            refreshLibrary();
            setRefreshToken((n) => n + 1);
          }
        })
        .catch(console.error);
    },
    [refreshLibrary],
  );

  const askGroups = groupByFolder(askPaths);
  const liveStats = stats ?? EMPTY_STATS;

  return (
    <div className="app-shell">
      <TitleBar
        onSettings={() => {
          setView("settings");
        }}
        onTags={() => {
          setView("tags");
        }}
      />

      {mode === "empty" ? (
        <>
          <FirstLaunch
            onAddFolder={addRoot}
            onPreferences={() => {
              setView("settings");
            }}
          />
          <StatusBar rootCount={0} fileCount={0} />
        </>
      ) : null}

      {mode === "library" ? (
        <LibraryView
          settings={settings}
          onSettingChange={setSetting}
          stats={liveStats}
          folders={folders}
          tags={tags}
          refreshToken={refreshToken}
          onRefreshLibrary={refreshLibrary}
          onAddRoot={addRoot}
          onManageTags={() => {
            setView("tags");
          }}
          onAnalysisStart={onAnalysisStart}
        />
      ) : null}

      {view === "settings" ? (
        <SettingsView
          settings={settings}
          onChange={setSetting}
          outputDevices={outputDevices}
          stats={liveStats}
          onClose={() => {
            setView("library");
          }}
          onClearCache={() => {
            void ipc.clearJitCache().then(refreshLibrary).catch(console.error);
          }}
          onChangeCacheDir={() => {
            void open({ directory: true, multiple: false })
              .then((selected) => {
                if (typeof selected !== "string") return;
                return ipc.setClipsDir(selected).then(refreshLibrary);
              })
              .catch(console.error);
          }}
          onPurgeMissing={() => {
            void ipc
              .purgeMissing()
              .then(() => {
                refreshLibrary();
                setRefreshToken((n) => n + 1);
              })
              .catch(console.error);
          }}
        />
      ) : null}

      {view === "tags" ? (
        <TagManagerView
          tags={tags}
          onRefresh={() => {
            refreshLibrary();
            setRefreshToken((n) => n + 1);
          }}
          onClose={() => {
            setView("library");
          }}
        />
      ) : null}

      {askGroups.length > 0 ? (
        <AskIndexToast
          groups={askGroups}
          onRespond={respondAsk}
          onDismiss={() => {
            setAskPaths([]);
          }}
        />
      ) : null}

      {launchUpdate != null ? (
        <UpdateAvailableDialog
          available={launchUpdate}
          onDismiss={() => {
            setLaunchUpdate(null);
          }}
        />
      ) : null}
    </div>
  );
}
