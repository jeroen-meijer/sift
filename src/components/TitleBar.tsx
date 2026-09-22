import { GearIcon, TagIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

interface Props {
  onSettings: () => void;
  onTags: () => void;
}

export function TitleBar({ onSettings, onTags }: Props) {
  const { t } = useTranslation("common");

  return (
    <header className="titlebar">
      <div className="titlebar-traffic" aria-hidden>
        <span className="dot red" />
        <span className="dot yellow" />
        <span className="dot green" />
      </div>
      <div className="titlebar-title">{t("appName")}</div>
      <div className="titlebar-actions">
        <button
          type="button"
          className="btn-icon"
          title={t("settings")}
          aria-label={t("settings")}
          onClick={onSettings}
        >
          <GearIcon size={15} />
        </button>
        <button
          type="button"
          className="btn-icon"
          title={t("tags")}
          aria-label={t("tags")}
          onClick={onTags}
        >
          <TagIcon size={15} />
        </button>
      </div>
    </header>
  );
}
