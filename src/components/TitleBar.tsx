import { GearIcon, TagIcon } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";

interface Props {
  onSettings: () => void;
  onTags: () => void;
}

function beginDrag(e: React.MouseEvent) {
  if (e.button !== 0) return;
  // Buttons and other controls keep normal clicks.
  if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
  e.preventDefault();
  void getCurrentWindow().startDragging();
}

export function TitleBar({ onSettings, onTags }: Props) {
  const { t } = useTranslation("common");

  return (
    <header className="titlebar" data-tauri-drag-region onMouseDown={beginDrag}>
      {/* Room for the native macOS traffic lights under the Overlay title bar. */}
      <div className="titlebar-spacer" aria-hidden data-tauri-drag-region />
      <div className="titlebar-title" data-tauri-drag-region>
        {t("appName")}
      </div>
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
          title={t("tagManagement")}
          aria-label={t("tagManagement")}
          onClick={onTags}
        >
          <TagIcon size={15} />
        </button>
      </div>
    </header>
  );
}
