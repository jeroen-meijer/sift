import { FolderPlusIcon, WaveformIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

interface Props {
  onAddFolder: () => void;
  onPreferences: () => void;
}

export function FirstLaunch({ onAddFolder, onPreferences }: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");

  return (
    <div className="first-launch">
      <aside className="sidebar">
        <div className="sidebar-title kicker">{t("library")}</div>
        <div className="sidebar-empty">{t("noRoots")}</div>
      </aside>
      <section className="first-launch-main">
        <div className="first-launch-card">
          <div className="first-launch-icon">
            <WaveformIcon size={28} />
          </div>
          <h1>{t("firstLaunchTitle")}</h1>
          <p>{t("firstLaunchBody")}</p>
          <div className="first-launch-actions">
            <button type="button" className="btn btn-primary" onClick={onAddFolder}>
              <FolderPlusIcon size={15} />
              {t("addFolder")}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onPreferences}>
              {tc("preferences")}
            </button>
          </div>
          <div className="first-launch-hint rule">{t("firstLaunchHint")}</div>
        </div>
      </section>
    </div>
  );
}
