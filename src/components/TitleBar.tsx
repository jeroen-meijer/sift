import {
  CopySimpleIcon,
  GearIcon,
  MinusIcon,
  SquareIcon,
  TagIcon,
  XIcon,
} from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isWindowsPlatform } from "../lib/bindings";

interface Props {
  onSettings: () => void;
  onTags: () => void;
}

function beginDrag(e: React.MouseEvent) {
  if (e.button !== 0) return;
  // Buttons and other controls keep normal clicks.
  if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
  e.preventDefault();
  const win = getCurrentWindow();
  if (e.detail === 2) {
    void win.toggleMaximize();
    return;
  }
  void win.startDragging();
}

function WindowCaptionButtons() {
  const { t } = useTranslation("common");
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void win.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value);
    });
    void win.onResized(() => {
      void win.isMaximized().then((value) => {
        if (!cancelled) setMaximized(value);
      });
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const win = getCurrentWindow();

  return (
    <div className="titlebar-caption" role="group" aria-label={t("chrome.windowControls")}>
      <button
        type="button"
        className="titlebar-caption-btn"
        title={t("chrome.minimize")}
        aria-label={t("chrome.minimize")}
        onClick={() => {
          void win.minimize();
        }}
      >
        <MinusIcon size={10} weight="bold" />
      </button>
      <button
        type="button"
        className="titlebar-caption-btn"
        title={maximized ? t("chrome.restore") : t("chrome.maximize")}
        aria-label={maximized ? t("chrome.restore") : t("chrome.maximize")}
        onClick={() => {
          void win.toggleMaximize();
        }}
      >
        {maximized ? <CopySimpleIcon size={10} /> : <SquareIcon size={10} weight="bold" />}
      </button>
      <button
        type="button"
        className="titlebar-caption-btn titlebar-caption-close"
        title={t("action.close")}
        aria-label={t("action.close")}
        onClick={() => {
          void win.close();
        }}
      >
        <XIcon size={10} weight="bold" />
      </button>
    </div>
  );
}

export function TitleBar({ onSettings, onTags }: Props) {
  const { t } = useTranslation("common");
  const windowsChrome = isWindowsPlatform();

  return (
    <header
      className={windowsChrome ? "titlebar titlebar--windows" : "titlebar"}
      data-tauri-drag-region
      onMouseDown={beginDrag}
    >
      <div className="titlebar-leading" aria-hidden data-tauri-drag-region>
        {/* Room for the native macOS traffic lights under the Overlay title bar. */}
        {!windowsChrome ? <div className="titlebar-spacer" data-tauri-drag-region /> : null}
      </div>
      <div className="titlebar-title" data-tauri-drag-region>
        {t("appName")}
      </div>
      <div className="titlebar-actions">
        <button
          type="button"
          className="btn-icon"
          title={t("chrome.settings")}
          aria-label={t("chrome.settings")}
          onClick={onSettings}
        >
          <GearIcon size={15} />
        </button>
        <button
          type="button"
          className="btn-icon"
          title={t("chrome.tagManagement")}
          aria-label={t("chrome.tagManagement")}
          onClick={onTags}
        >
          <TagIcon size={15} />
        </button>
        {windowsChrome ? <WindowCaptionButtons /> : null}
      </div>
    </header>
  );
}
