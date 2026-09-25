import {
  FoldersIcon,
  InfoIcon,
  KeyboardIcon,
  PaintBucketIcon,
  PlayCircleIcon,
  PlusIcon,
  PulseIcon,
  XIcon,
} from "@phosphor-icons/react";
import { getVersion } from "@tauri-apps/api/app";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { keys, SHORTCUT_ROWS, matchesBinding } from "../lib/bindings";
import { formatBytes, formatCount } from "../lib/format";
import { hotkeyId, hotkeyLabel } from "../lib/hotkey";
import {
  ipc,
  type AppSettings,
  type DbStats,
  type NewFileMode,
  type OutputDevice,
  type SpliceCatalogStatus,
  type WaveformView as WaveformMode,
} from "../lib/ipc";
import {
  checkForAppUpdate,
  installAvailableUpdate,
  type AvailableUpdate,
  type UpdateStatus,
} from "../lib/updates";
import {
  THEMES,
  THEME_INFO,
  normalizeThemeId,
} from "../theme";
import { Dialog, DialogDismissButton } from "../ui/Dialog";
import { PillSelect } from "../ui/PillSelect";
import { Segmented } from "../ui/Segmented";
import { Switch } from "../ui/Switch";
import { BpmRangePicker } from "./BpmRangePicker";
import { ReanalyzeLibraryDialog } from "./dialogs/ReanalyzeLibraryDialog";
import { ThemeWavePreview } from "./ThemeWavePreview";

type SectionId = "appearance" | "playback" | "library" | "analysis" | "shortcuts" | "about";

const SECTIONS: SectionId[] = [
  "appearance",
  "playback",
  "library",
  "analysis",
  "shortcuts",
  "about",
];

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {hint ? <div className="settings-row-hint">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

interface Props {
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  outputDevices: OutputDevice[];
  stats: DbStats;
  onClose: () => void;
  onClearCache: () => void;
  onChangeCacheDir: () => void;
  onPurgeMissing: () => void;
}

export function SettingsView({
  settings,
  onChange,
  outputDevices,
  stats,
  onClose,
  onClearCache,
  onChangeCacheDir,
  onPurgeMissing,
}: Props) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const [active, setActive] = useState<SectionId>("appearance");
  const [recording, setRecording] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [spliceStatus, setSpliceStatus] = useState<SpliceCatalogStatus | null>(null);
  const [confirmReanalyze, setConfirmReanalyze] = useState(false);
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Ignore scroll-spy briefly after a nav click so short last sections stay selected. */
  const pinned = useRef(false);
  const pinTimer = useRef(0);
  const currentTheme = normalizeThemeId(settings.theme);

  const loadSpliceStatus = useCallback(() => {
    void ipc
      .spliceCatalogStatus()
      .then(setSpliceStatus)
      .catch((err: unknown) => {
        console.error(err);
        setSpliceStatus({
          path: null,
          row_count: null,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          splice_folder: null,
        });
      });
  }, []);

  useEffect(() => {
    loadSpliceStatus();
  }, [loadSpliceStatus, settings.splice_enabled]);

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch((err: unknown) => {
        console.error(err);
        setAppVersion(null);
      });
  }, []);

  const runUpdateCheck = useCallback(() => {
    setUpdateStatus("checking");
    setUpdateError(null);
    setAvailableUpdate(null);
    void checkForAppUpdate().then((outcome) => {
      switch (outcome.kind) {
        case "skipped":
          setUpdateStatus("idle");
          setUpdateError(t("about.updates.skippedDev"));
          break;
        case "upToDate":
          setUpdateStatus("upToDate");
          break;
        case "available":
          setAvailableUpdate(outcome.available);
          setUpdateStatus("available");
          break;
        case "error":
          setUpdateStatus("error");
          setUpdateError(outcome.message);
          break;
      }
    });
  }, [t]);

  const runUpdateInstall = useCallback(() => {
    if (availableUpdate == null) return;
    setUpdateStatus("downloading");
    setUpdateError(null);
    void installAvailableUpdate(availableUpdate).catch((err: unknown) => {
      setUpdateStatus("error");
      setUpdateError(err instanceof Error ? err.message : String(err));
    });
  }, [availableUpdate]);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      const id = hotkeyId(e);
      if (!id) return;
      onChange("hold_hover_hotkey", id);
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [recording, onChange]);

  /*
   * Highlight the last section whose top crossed near the top of the pane.
   * At the bottom of the scroll, always highlight the last section: Shortcuts
   * is shorter than the pane, so Analysis would otherwise stay selected while
   * Shortcuts is on screen.
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const sync = () => {
      if (pinned.current) return;
      const sections = SECTIONS.map((id) => ({
        id,
        el: body.querySelector<HTMLElement>(`#settings-${id}`),
      })).filter((s): s is { id: SectionId; el: HTMLElement } => s.el != null);

      const maxScroll = body.scrollHeight - body.clientHeight;
      if (maxScroll > 0 && body.scrollTop >= maxScroll - 8) {
        const last = sections[sections.length - 1];
        if (last) setActive(last.id);
        return;
      }

      const marker = body.scrollTop + 48;
      let current: SectionId = sections[0]?.id ?? "appearance";
      for (const section of sections) {
        if (section.el.offsetTop <= marker) current = section.id;
        else break;
      }
      setActive(current);
    };

    sync();
    body.addEventListener("scroll", sync, { passive: true });
    return () => {
      body.removeEventListener("scroll", sync);
      window.clearTimeout(pinTimer.current);
    };
  }, []);

  const scrollTo = (section: SectionId) => {
    setActive(section);
    pinned.current = true;
    window.clearTimeout(pinTimer.current);
    pinTimer.current = window.setTimeout(() => {
      pinned.current = false;
    }, 500);
    bodyRef.current?.querySelector(`#settings-${section}`)?.scrollIntoView({ block: "start" });
  };

  const nav: { id: SectionId; label: string; icon: ReactNode }[] = [
    { id: "appearance", label: t("nav.appearance"), icon: <PaintBucketIcon size={15} /> },
    { id: "playback", label: t("nav.playback"), icon: <PlayCircleIcon size={15} weight="fill" /> },
    { id: "library", label: t("nav.library"), icon: <FoldersIcon size={15} /> },
    { id: "analysis", label: t("nav.analysis"), icon: <PulseIcon size={15} /> },
    { id: "shortcuts", label: t("nav.shortcuts"), icon: <KeyboardIcon size={15} /> },
    { id: "about", label: t("nav.about"), icon: <InfoIcon size={15} /> },
  ];

  const addPattern = () => {
    const pattern = newPattern.trim();
    if (!pattern || settings.ignore_list.includes(pattern)) return;
    onChange("ignore_list", [...settings.ignore_list, pattern]);
    setNewPattern("");
  };

  return (
    <Dialog width={960} onClose={onClose} label={t("title")} bare className="settings-dialog">
      <div className="settings-modal">
        <nav className="settings-nav">
          <div className="settings-nav-head">
            <div className="settings-nav-title">{t("title")}</div>
            <DialogDismissButton className="btn-icon" aria-label={tc("action.close")}>
              <XIcon size={14} />
            </DialogDismissButton>
          </div>
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${active === item.id ? " on" : ""}`}
              onClick={() => {
                scrollTo(item.id);
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="full-view-main">
          <div className="settings-body" ref={bodyRef}>
            <div className="settings-sections">
              <section id="settings-appearance">
                <div className="settings-themes-head">
                  <div className="kicker settings-section-label">{t("appearance.themes.label")}</div>
                  <span className="settings-themes-count">{t("appearance.themes.hint")}</span>
                </div>
                <div className="theme-grid" role="listbox" aria-label={t("appearance.themes.label")}>
                  {THEMES.map((id) => {
                    const info = THEME_INFO[id];
                    const selected = currentTheme === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`theme-card${selected ? " on" : ""}`}
                        onClick={() => {
                          onChange("theme", id);
                        }}
                      >
                        <div className="theme-card-top">
                          <div className="theme-card-text">
                            <div className="theme-card-name">{t(`appearance.themes.${id}.name`)}</div>
                            <div className="theme-card-blurb">{t(`appearance.themes.${id}.blurb`)}</div>
                          </div>
                          <div className="theme-card-swatches" aria-hidden>
                            {info.swatches.map((color) => (
                              <span
                                key={color}
                                className="theme-swatch"
                                style={{ background: color }}
                              />
                            ))}
                          </div>
                        </div>
                        <ThemeWavePreview themeId={id} />
                      </button>
                    );
                  })}
                </div>
              </section>

              <section id="settings-playback" className="rule">
                <div className="kicker settings-section-label">{t("nav.playback")}</div>
                <Row title={t("playback.playOnSelect.label")} hint={t("playback.playOnSelect.hint")}>
                  <Switch
                    label={t("playback.playOnSelect.label")}
                    checked={settings.play_on_select}
                    onChange={(v) => {
                      onChange("play_on_select", v);
                    }}
                  />
                </Row>
                <Row title={t("playback.loopPreview.label")} hint={t("playback.loopPreview.hint")}>
                  <Switch
                    label={t("playback.loopPreview.label")}
                    checked={settings.loop_preview}
                    onChange={(v) => {
                      onChange("loop_preview", v);
                    }}
                  />
                </Row>
                <Row title={t("playback.waveformView.label")} hint={t("playback.waveformView.hint")}>
                  <Segmented<WaveformMode>
                    label={t("playback.waveformView.label")}
                    value={settings.waveform_view}
                    options={[
                      { value: "stereo", label: t("playback.waveformView.stereo") },
                      { value: "mono", label: t("playback.waveformView.mono") },
                    ]}
                    onChange={(v) => {
                      onChange("waveform_view", v);
                    }}
                  />
                </Row>
                <Row title={t("playback.coloredWaveforms.label")} hint={t("playback.coloredWaveforms.hint")}>
                  <Segmented<"on" | "off">
                    label={t("playback.coloredWaveforms.label")}
                    value={settings.colored_waveforms ? "on" : "off"}
                    options={[
                      { value: "on", label: t("playback.coloredWaveforms.on") },
                      { value: "off", label: t("playback.coloredWaveforms.off") },
                    ]}
                    onChange={(v) => {
                      onChange("colored_waveforms", v === "on");
                    }}
                  />
                </Row>
                <Row title={t("playback.outputDevice.label")} hint={t("playback.outputDevice.hint")}>
                  <PillSelect
                    label={t("playback.outputDevice.label")}
                    variant="input"
                    width={248}
                    value={settings.output_device}
                    options={outputDevices.map((d) => ({ value: d.id, label: d.name }))}
                    onChange={(v) => {
                      onChange("output_device", v);
                    }}
                  />
                </Row>
              </section>

              <section id="settings-library" className="rule">
                <div className="kicker settings-section-label">{t("nav.library")}</div>
                <Row title={t("library.newFiles.label")} hint={t("library.newFiles.hint")}>
                  <Segmented<NewFileMode>
                    label={t("library.newFiles.label")}
                    value={settings.new_file_mode}
                    options={[
                      { value: "auto", label: t("library.newFiles.autoIndex") },
                      { value: "ask", label: t("library.newFiles.askFirst") },
                    ]}
                    onChange={(v) => {
                      onChange("new_file_mode", v);
                    }}
                  />
                </Row>
                <Row title={t("library.notifyAutoIndex.label")}>
                  <Switch
                    label={t("library.notifyAutoIndex.label")}
                    checked={settings.notify_auto_index}
                    onChange={(v) => {
                      onChange("notify_auto_index", v);
                    }}
                  />
                </Row>

                <div className="settings-stack">
                  <div className="settings-row-title">{t("library.ignoreList.label")}</div>
                  <div className="settings-row-hint">{t("library.ignoreList.hint")}</div>
                  <div className="ignore-box">
                    {settings.ignore_list.map((pattern) => (
                      <div key={pattern} className="ignore-row mono">
                        {pattern}
                        <button
                          type="button"
                          aria-label={t("library.ignoreList.removePattern")}
                          onClick={() => {
                            onChange(
                              "ignore_list",
                              settings.ignore_list.filter((p) => p !== pattern),
                            );
                          }}
                        >
                          <XIcon size={11} />
                        </button>
                      </div>
                    ))}
                    <div className="ignore-add">
                      <PlusIcon size={11} />
                      <input
                        value={newPattern}
                        placeholder={t("library.ignoreList.patternPlaceholder")}
                        aria-label={t("library.ignoreList.addPattern")}
                        onChange={(e) => {
                          setNewPattern(e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (matchesBinding(e, keys.confirm)) addPattern();
                        }}
                        onBlur={addPattern}
                      />
                    </div>
                  </div>
                </div>

                <div className="settings-stack">
                  <div className="settings-row-title">{t("library.onlineOnly.label")}</div>
                  <div className="settings-row-hint">{t("library.onlineOnly.hint")}</div>
                </div>

                <Row
                  title={t("library.missingSamples.label")}
                  hint={t("library.missingSamples.hint", { count: stats.missing })}
                >
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={stats.missing === 0}
                    onClick={onPurgeMissing}
                  >
                    {t("library.missingSamples.purge")}
                  </button>
                </Row>
              </section>

              <section id="settings-analysis" className="rule">
                <div className="kicker settings-section-label">{t("nav.analysis")}</div>
                <div className="settings-stack">
                  <div className="settings-row-title">{t("analysis.bpmRange.label")}</div>
                  <div className="settings-row-hint">{t("analysis.bpmRange.hint")}</div>
                  <BpmRangePicker
                    min={settings.bpm_range_min}
                    max={settings.bpm_range_max}
                    showDefaultNote
                    onChange={(min, max) => {
                      onChange("bpm_range_min", min);
                      onChange("bpm_range_max", max);
                    }}
                  />
                </div>

                <Row title={t("analysis.splice.label")} hint={t("analysis.splice.hint")}>
                  <Switch
                    label={t("analysis.splice.label")}
                    checked={settings.splice_enabled}
                    onChange={(v) => {
                      onChange("splice_enabled", v);
                    }}
                  />
                </Row>
                <div className="settings-stack settings-status-line">
                  <div className="settings-row-hint mono">
                    {spliceStatus == null
                      ? t("analysis.splice.status.loading")
                      : spliceStatus.ok
                        ? t("analysis.splice.status.ok", {
                            path: spliceStatus.path ?? "",
                            count: formatCount(spliceStatus.row_count ?? 0),
                          })
                        : spliceStatus.error
                          ? t("analysis.splice.status.error", { error: spliceStatus.error })
                          : t("analysis.splice.status.missing")}
                  </div>
                </div>

                <Row title={t("analysis.refreshMetadata.label")} hint={t("analysis.refreshMetadata.hint")}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!settings.splice_enabled || refreshingMeta}
                    onClick={() => {
                      setRefreshingMeta(true);
                      void ipc
                        .refreshMetadata()
                        .then(() => {
                          loadSpliceStatus();
                        })
                        .catch(console.error)
                        .finally(() => {
                          setRefreshingMeta(false);
                        });
                    }}
                  >
                    {t("analysis.refreshMetadata.label")}
                  </button>
                </Row>

                <Row title={t("analysis.reanalyze.label")} hint={t("analysis.reanalyze.hint")}>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      setConfirmReanalyze(true);
                    }}
                  >
                    {t("analysis.reanalyze.label")}
                  </button>
                </Row>

                <Row title={t("analysis.jitCache.label")} hint={`${stats.clips_dir} · ${formatBytes(stats.clips_bytes)}`}>
                  <div className="settings-button-pair">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onChangeCacheDir}>
                      {t("analysis.jitCache.change")}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onClearCache}>
                      {t("analysis.jitCache.clear")}
                    </button>
                  </div>
                </Row>
              </section>

              <section id="settings-shortcuts" className="rule">
                <div className="kicker settings-section-label">{t("nav.shortcuts")}</div>
                <Row title={t("shortcuts.holdHover.label")} hint={t("shortcuts.holdHover.hint")}>
                  <div className="settings-button-pair">
                    <span
                      className={`hotkey-slot mono${settings.hold_hover_hotkey ? " bound" : ""}`}
                    >
                      {recording
                        ? t("shortcuts.holdHover.recording")
                        : (hotkeyLabel(settings.hold_hover_hotkey) ?? t("shortcuts.holdHover.unbound"))}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setRecording(true);
                      }}
                    >
                      {t("shortcuts.holdHover.record")}
                    </button>
                    {settings.hold_hover_hotkey ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          onChange("hold_hover_hotkey", null);
                        }}
                      >
                        {t("shortcuts.holdHover.clear")}
                      </button>
                    ) : null}
                  </div>
                </Row>

                <div className="shortcut-panel">
                  <div className="shortcut-panel-note">{t("shortcuts.fixedKeysNote")}</div>
                  <div className="shortcut-grid">
                    {SHORTCUT_ROWS.map((row) => (
                      <div key={row.binding} className="shortcut-item">
                        <span className="mono shortcut-keys">
                          {row.binding === "selectUp"
                            ? `${keys.selectUp.hint} ${keys.selectDown.hint}`
                            : keys[row.binding].hint}
                        </span>
                        <span>{t(row.descriptionKey)}</span>
                      </div>
                    ))}
                    <div className="shortcut-item">
                      <span className="mono shortcut-keys">
                        {keys.freeTime.hint}
                        {keys.zeroCrossing.hint}
                      </span>
                      <span>{t("shortcuts.key.zeroFree")}</span>
                    </div>
                    <div className="shortcut-item">
                      <span className="mono shortcut-keys">{keys.freeTime.hint}</span>
                      <span>{t("shortcuts.key.range")}</span>
                    </div>
                    <div className="shortcut-item">
                      <span className="mono shortcut-keys">⌘ / Ctrl</span>
                      <span>{t("shortcuts.key.toggle")}</span>
                    </div>
                  </div>
                </div>
              </section>

              <section id="settings-about" className="rule">
                <div className="kicker settings-section-label">{t("nav.about")}</div>
                <Row title={t("about.version.label")} hint={t("about.version.hint")}>
                  <span className="mono settings-about-version">
                    {appVersion ?? "…"}
                  </span>
                </Row>
                <Row
                  title={t("about.updates.check")}
                  {...(updateStatus === "upToDate"
                    ? { hint: t("about.updates.upToDate") }
                    : updateStatus === "available" && availableUpdate != null
                      ? {
                          hint: t("about.updates.availableStatus", {
                            version: availableUpdate.version,
                          }),
                        }
                      : updateStatus === "downloading"
                        ? { hint: t("about.updates.downloading") }
                        : updateStatus === "error"
                          ? { hint: updateError ?? t("about.updates.error") }
                          : updateError != null && updateStatus === "idle"
                            ? { hint: updateError }
                            : {})}
                >
                  {updateStatus === "available" && availableUpdate != null ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={false}
                      onClick={runUpdateInstall}
                    >
                      {t("about.updates.dialog.install")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={updateStatus === "checking" || updateStatus === "downloading"}
                      onClick={runUpdateCheck}
                    >
                      {updateStatus === "checking" ? t("about.updates.checking") : t("about.updates.check")}
                    </button>
                  )}
                </Row>
              </section>
            </div>
          </div>
        </div>
      </div>

      {confirmReanalyze ? (
        <ReanalyzeLibraryDialog
          onCancel={() => {
            setConfirmReanalyze(false);
          }}
          onConfirm={() => {
            void ipc.reanalyzeEntireLibrary().catch(console.error);
          }}
        />
      ) : null}
    </Dialog>
  );
}
