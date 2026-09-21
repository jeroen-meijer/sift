import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FirstLaunch } from "./FirstLaunch";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import "./AppShell.css";

export type AppView = "library" | "settings" | "tags";

export function AppShell() {
  const { t } = useTranslation("common");
  const { t: ts } = useTranslation("settings");
  const { t: tt } = useTranslation("tags");
  const [view, setView] = useState<AppView>("library");
  const rootCount = 0;
  const fileCount = 0;
  const isEmpty = rootCount === 0;

  return (
    <div className="app-shell">
      <TitleBar onSettings={() => setView("settings")} onTags={() => setView("tags")} />

      {view === "library" && isEmpty ? (
        <FirstLaunch
          onAddFolder={() => {
            /* Phase 04: folder picker */
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
            <button type="button" className="btn btn-secondary" onClick={() => setView("library")}>
              {t("close")}
            </button>
          </div>
        </div>
      ) : null}

      <StatusBar rootCount={rootCount} fileCount={fileCount} />
    </div>
  );
}
