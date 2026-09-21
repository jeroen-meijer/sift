import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FirstLaunch } from "./FirstLaunch";
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

export function AppShell() {
  const { t } = useTranslation("common");
  const { t: ts } = useTranslation("settings");
  const { t: tt } = useTranslation("tags");
  const [view, setView] = useState<AppView>("library");
  const [stats, setStats] = useState<DbStats>({
    roots: 0,
    samples: 0,
    tags: 0,
    data_dir: "",
    clips_dir: "",
  });

  useEffect(() => {
    void invoke<DbStats>("db_stats")
      .then(setStats)
      .catch((err) => console.error("db_stats", err));
  }, [view]);

  const isEmpty = stats.roots === 0;

  return (
    <div className="app-shell">
      <TitleBar onSettings={() => setView("settings")} onTags={() => setView("tags")} />

      {view === "library" && isEmpty ? (
        <FirstLaunch
          onAddFolder={() => {
            /* Phase 04 */
          }}
          onPreferences={() => setView("settings")}
        />
      ) : null}

      {view === "library" && !isEmpty ? (
        <div className="library-placeholder">{t("appName")}</div>
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
            <p className="muted">
              {stats.tags} tags seeded
            </p>
            <button type="button" className="btn btn-secondary" onClick={() => setView("library")}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      <StatusBar rootCount={stats.roots} fileCount={stats.samples} />
    </div>
  );
}
