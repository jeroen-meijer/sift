import {
  FoldersIcon,
  KeyboardIcon,
  PlayCircleIcon,
  PlusIcon,
  PulseIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../lib/format";
import { hotkeyId, hotkeyLabel } from "../lib/hotkey";
import type {
  AppSettings,
  DbStats,
  NewFileMode,
  OutputDevice,
  WaveformView as WaveformMode,
} from "../lib/ipc";
import { PillSelect } from "../ui/PillSelect";
import { Segmented } from "../ui/Segmented";
import { Switch } from "../ui/Switch";
import { BpmRangePicker } from "./BpmRangePicker";

type SectionId = "playback" | "library" | "analysis" | "shortcuts";

const SHORTCUTS: { keys: string; descriptionKey: string }[] = [
  { keys: "Enter", descriptionKey: "keyPlayStart" },
  { keys: "Space", descriptionKey: "keyPause" },
  { keys: "↑ ↓", descriptionKey: "keyMove" },
  { keys: "⇧", descriptionKey: "keyRange" },
  { keys: "⌘ / Ctrl", descriptionKey: "keyToggle" },
  { keys: "Z", descriptionKey: "keyZero" },
  { keys: "⇧Z", descriptionKey: "keyZeroFree" },
  { keys: "⌘Z", descriptionKey: "keyUndo" },
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
  const [active, setActive] = useState<SectionId>("playback");
  const [recording, setRecording] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

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

  const scrollTo = (section: SectionId) => {
    setActive(section);
    bodyRef.current?.querySelector(`#settings-${section}`)?.scrollIntoView({ block: "start" });
  };

  const nav: { id: SectionId; label: string; icon: ReactNode }[] = [
    { id: "playback", label: t("navPlayback"), icon: <PlayCircleIcon size={15} weight="fill" /> },
    { id: "library", label: t("navLibrary"), icon: <FoldersIcon size={15} /> },
    { id: "analysis", label: t("navAnalysis"), icon: <PulseIcon size={15} /> },
    { id: "shortcuts", label: t("navShortcuts"), icon: <KeyboardIcon size={15} /> },
  ];

  const addPattern = () => {
    const pattern = newPattern.trim();
    if (!pattern || settings.ignore_list.includes(pattern)) return;
    onChange("ignore_list", [...settings.ignore_list, pattern]);
    setNewPattern("");
  };

  return (
    <div className="full-view">
      <nav className="settings-nav">
        <div className="settings-nav-title">{t("title")}</div>
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
            <section id="settings-playback">
              <div className="kicker settings-section-label">{t("navPlayback")}</div>
              <Row title={t("playOnSelect")} hint={t("playOnSelectHint")}>
                <Switch
                  label={t("playOnSelect")}
                  checked={settings.play_on_select}
                  onChange={(v) => {
                    onChange("play_on_select", v);
                  }}
                />
              </Row>
              <Row title={t("loopPreview")} hint={t("loopPreviewHint")}>
                <Switch
                  label={t("loopPreview")}
                  checked={settings.loop_preview}
                  onChange={(v) => {
                    onChange("loop_preview", v);
                  }}
                />
              </Row>
              <Row title={t("waveformView")} hint={t("waveformViewHint")}>
                <Segmented<WaveformMode>
                  label={t("waveformView")}
                  value={settings.waveform_view}
                  options={[
                    { value: "stereo", label: t("waveformStereo") },
                    { value: "mono", label: t("waveformMono") },
                  ]}
                  onChange={(v) => {
                    onChange("waveform_view", v);
                  }}
                />
              </Row>
              <Row title={t("outputDevice")} hint={t("outputDeviceHint")}>
                <PillSelect
                  label={t("outputDevice")}
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
              <div className="kicker settings-section-label">{t("navLibrary")}</div>
              <Row title={t("newFiles")} hint={t("newFilesHint")}>
                <Segmented<NewFileMode>
                  label={t("newFiles")}
                  value={settings.new_file_mode}
                  options={[
                    { value: "auto", label: t("autoIndex") },
                    { value: "ask", label: t("askFirst") },
                  ]}
                  onChange={(v) => {
                    onChange("new_file_mode", v);
                  }}
                />
              </Row>
              <Row title={t("notifyAutoIndex")}>
                <Switch
                  label={t("notifyAutoIndex")}
                  checked={settings.notify_auto_index}
                  onChange={(v) => {
                    onChange("notify_auto_index", v);
                  }}
                />
              </Row>

              <div className="settings-stack">
                <div className="settings-row-title">{t("ignoreList")}</div>
                <div className="settings-row-hint">{t("ignoreListHint")}</div>
                <div className="ignore-box">
                  {settings.ignore_list.map((pattern) => (
                    <div key={pattern} className="ignore-row mono">
                      {pattern}
                      <button
                        type="button"
                        aria-label={t("removePattern")}
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
                      placeholder={t("patternPlaceholder")}
                      aria-label={t("addPattern")}
                      onChange={(e) => {
                        setNewPattern(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addPattern();
                      }}
                      onBlur={addPattern}
                    />
                  </div>
                </div>
              </div>

              <Row
                title={t("missingSamples")}
                hint={t("missingSamplesHint", { count: stats.missing })}
              >
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={stats.missing === 0}
                  onClick={onPurgeMissing}
                >
                  {t("purgeMissing")}
                </button>
              </Row>
            </section>

            <section id="settings-analysis" className="rule">
              <div className="kicker settings-section-label">{t("navAnalysis")}</div>
              <div className="settings-stack">
                <div className="settings-row-title">{t("bpmRange")}</div>
                <div className="settings-row-hint">{t("bpmRangeHint")}</div>
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

              <Row title={t("jitCache")} hint={`${stats.clips_dir} · ${formatBytes(stats.clips_bytes)}`}>
                <div className="settings-button-pair">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onChangeCacheDir}>
                    {t("change")}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onClearCache}>
                    {t("clearCache")}
                  </button>
                </div>
              </Row>
            </section>

            <section id="settings-shortcuts" className="rule">
              <div className="kicker settings-section-label">{t("navShortcuts")}</div>
              <Row title={t("holdHover")} hint={t("holdHoverHint")}>
                <div className="settings-button-pair">
                  <span
                    className={`hotkey-slot mono${settings.hold_hover_hotkey ? " bound" : ""}`}
                  >
                    {recording
                      ? t("recording")
                      : (hotkeyLabel(settings.hold_hover_hotkey) ?? t("holdHoverUnbound"))}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setRecording(true);
                    }}
                  >
                    {t("record")}
                  </button>
                  {settings.hold_hover_hotkey ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        onChange("hold_hover_hotkey", null);
                      }}
                    >
                      {t("clearBinding")}
                    </button>
                  ) : null}
                </div>
              </Row>

              <div className="shortcut-panel">
                <div className="shortcut-panel-note">{t("fixedKeys")}</div>
                <div className="shortcut-grid">
                  {SHORTCUTS.map((shortcut) => (
                    <div key={shortcut.keys} className="shortcut-item">
                      <span className="mono shortcut-keys">{shortcut.keys}</span>
                      <span>{t(shortcut.descriptionKey)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="full-view-footer">
          <span className="full-view-footer-note">{t("changesApply")}</span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tc("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
