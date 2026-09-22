import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { keys, matchesBinding } from "../lib/bindings";
import { formatCount } from "../lib/format";
import {
  ipc,
  type AnalysisProgress,
  type DbStats,
  type FolderNode,
  type IndexProgress,
  type OutputDevice,
  type TagNode,
} from "../lib/ipc";
import { useSettings } from "../lib/useSettings";
import { applyTheme } from "../theme";
import { groupByFolder } from "../lib/askIndex";
import { AskIndexToast } from "./AskIndexToast";
import { FirstLaunch } from "./FirstLaunch";
import { LibraryView } from "./LibraryView";
import { SettingsView } from "./SettingsView";
import { StatusBar, type AnalysisBar } from "./StatusBar";
import { TagManagerView } from "./TagManagerView";
import { TitleBar } from "./TitleBar";
import "../styles/base.css";
import "../ui/ui.css";
import "./shell.css";
import "./library.css";
import "./detail.css";
import "./views.css";

type View = "library" | "settings" | "tags";

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
  const { t } = useTranslation("common");
  const { t: tl } = useTranslation("library");
  const { settings, set: setSetting, loaded } = useSettings();

  useEffect(() => {
    if (!loaded) return;
    applyTheme(settings.theme);
  }, [loaded, settings.theme]);

  const [view, setView] = useState<View>("library");
  const [stats, setStats] = useState<DbStats>(EMPTY_STATS);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [tags, setTags] = useState<TagNode[]>([]);
  const [outputDevices, setOutputDevices] = useState<OutputDevice[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  const [indexStatus, setIndexStatus] = useState<string | undefined>();
  const [analysisBar, setAnalysisBar] = useState<AnalysisBar | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState<Set<number>>(() => new Set());
  const [askPaths, setAskPaths] = useState<string[]>([]);

  const refreshLibrary = useCallback(() => {
    void Promise.all([ipc.dbStats(), ipc.folderTree(), ipc.listTags()])
      .then(([nextStats, tree, tagTree]) => {
        setStats(nextStats);
        setFolders(tree);
        setTags(tagTree);
      })
      .catch(console.error);
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
    const bump = () => {
      refreshLibrary();
      setRefreshToken((n) => n + 1);
    };

    void listen<IndexProgress>("index-progress", ({ payload }) => {
      if (payload.done) {
        setIndexStatus(undefined);
        bump();
      } else {
        setIndexStatus(t("statusIndexing", { formatted: formatCount(payload.scanned) }));
      }
    }).then((fn) => unlisteners.push(fn));

    void listen<number[]>("analysis-queue", ({ payload }) => {
      setAnalyzingIds(new Set(payload));
      setAnalysisBar({ done: 0, total: payload.length });
    }).then((fn) => unlisteners.push(fn));

    void listen<AnalysisProgress>("analysis-progress", ({ payload }) => {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(payload.sample_id);
        return next;
      });
      if (payload.remaining === 0) {
        setAnalysisBar(null);
        setAnalyzingIds(new Set());
        bump();
      } else {
        setAnalysisBar({ done: payload.done, total: payload.done + payload.remaining });
      }
    }).then((fn) => unlisteners.push(fn));

    void listen("library-changed", bump).then((fn) => unlisteners.push(fn));

    void listen<{ paths: string[] }>("ask-index", ({ payload }) => {
      setAskPaths((prev) => [...new Set([...prev, ...payload.paths])]);
    }).then((fn) => unlisteners.push(fn));

    return () => {
      for (const off of unlisteners) off();
    };
  }, [refreshLibrary, t]);

  const addRoot = useCallback(() => {
    void open({ directory: true, multiple: false, title: tl("addFolder") })
      .then((selected) => {
        if (typeof selected !== "string") return;
        setIndexStatus(t("statusIndexing", { formatted: "0" }));
        return ipc.addRoot(selected).then(refreshLibrary);
      })
      .catch(console.error);
  }, [refreshLibrary, t, tl]);

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

  const isEmpty = stats.roots === 0;
  const askGroups = groupByFolder(askPaths);

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

      {isEmpty ? (
        <>
          <FirstLaunch
            onAddFolder={addRoot}
            onPreferences={() => {
              setView("settings");
            }}
          />
          <StatusBar rootCount={0} fileCount={0} statusText={indexStatus} />
        </>
      ) : null}

      {!isEmpty && loaded ? (
        <LibraryView
          settings={settings}
          onSettingChange={setSetting}
          stats={stats}
          folders={folders}
          tags={tags}
          analyzingIds={analyzingIds}
          analysisBar={analysisBar}
          statusText={indexStatus}
          refreshToken={refreshToken}
          onRefreshLibrary={refreshLibrary}
          onAddRoot={addRoot}
          onManageTags={() => {
            setView("tags");
          }}
          onAnalysisStart={() => {
            setAnalysisBar({ done: 0, total: 1 });
          }}
        />
      ) : null}

      {view === "settings" ? (
        <SettingsView
          settings={settings}
          onChange={setSetting}
          outputDevices={outputDevices}
          stats={stats}
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
    </div>
  );
}
