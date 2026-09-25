import { CheckIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keys, matchesBinding } from "../lib/bindings";
import { BEAT_PRESETS, beatsMatchBpm, sharedBpmFromBeats, sharedDuration } from "../lib/bpm";
import type { SampleRow } from "../lib/ipc";
import { Checkbox } from "../ui/Checkbox";

export const BPM_PANEL_WIDTH = 244;

interface Props {
  /** Every sample the menu will act on, not just the row that was clicked. */
  targets: SampleRow[];
  /** The row that was right-clicked; its BPM seeds the field. */
  focused: SampleRow;
  /** The analysis range from Settings, used to mute implausible beat counts. */
  bpmMin: number;
  bpmMax: number;
  round: boolean;
  onRoundChange: (round: boolean) => void;
  onSetBpm: (bpm: number) => void;
  onSetFromBeats: (beats: number) => void;
  onClear: () => void;
}

/**
 * Three ways into the same field: type a number, pick how many beats the
 * sample holds, or clear it. Each beat count shows the BPM it would produce.
 */
export function SetBpmPanel({
  targets,
  focused,
  bpmMin,
  bpmMax,
  round,
  onRoundChange,
  onSetBpm,
  onSetFromBeats,
  onClear,
}: Props) {
  const { t } = useTranslation("library");
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stored = focused.bpm == null ? "" : String(Math.round(focused.bpm));
  const [draft, setDraft] = useState(stored);
  const [customBeats, setCustomBeats] = useState("");

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const durations = targets.map((sample) => sample.duration_ms);
  const duration = sharedDuration(durations);
  const hasLength = durations.some((ms) => ms != null && ms > 0);

  const commitDraft = () => {
    const text = draft.trim();
    if (text === stored) return;
    const value = Number(text);
    if (text !== "" && Number.isFinite(value) && value > 0) onSetBpm(value);
  };

  /*
   * Leaving the field for a beat row must not write the old number on the way
   * out: the click the user is making is the one that counts.
   */
  const commitOnLeavingPanel = (e: React.FocusEvent) => {
    if (panelRef.current?.contains(e.relatedTarget)) return;
    commitDraft();
  };

  const preview = (beats: number) => sharedBpmFromBeats(durations, beats, round);

  /*
   * The arrow and the number are separate cells so the arrows line up down the
   * column while the numbers stay flush right.
   */
  const previewCells = (value: number | "varies" | null) =>
    value == null ? null : (
      <>
        <span className="bpm-panel-arrow" aria-hidden>
          →
        </span>
        <span className="bpm-panel-number">{value === "varies" ? t("setBpm.varies") : value}</span>
      </>
    );

  const beatRow = (beats: number, key: string) => {
    const value = preview(beats);
    const outOfRange = typeof value === "number" && (value < bpmMin || value > bpmMax);
    const matches = beatsMatchBpm(focused.duration_ms, focused.bpm, beats);
    return (
      <button
        key={key}
        type="button"
        className={`menu-item bpm-panel-beats${outOfRange ? " muted" : ""}${matches ? " current" : ""}`}
        disabled={value == null}
        onClick={() => {
          onSetFromBeats(beats);
        }}
      >
        <span className="menu-label">{t("setBpm.beats", { count: beats })}</span>
        {matches ? <CheckIcon size={11} weight="bold" className="bpm-panel-tick" /> : null}
        {previewCells(value)}
      </button>
    );
  };

  const customCount = Number(customBeats.trim());
  const customValid = customBeats.trim() !== "" && Number.isFinite(customCount) && customCount > 0;

  return (
    <div className="bpm-panel" ref={panelRef}>
      <div className="bpm-panel-field">
        <input
          ref={inputRef}
          className="input input-mono bpm-panel-input"
          value={draft}
          inputMode="decimal"
          aria-label={t("setBpm.value")}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (matchesBinding(e, keys.confirm)) commitDraft();
          }}
          onBlur={commitOnLeavingPanel}
        />
        <span className="bpm-panel-unit">{t("setBpm.value")}</span>
      </div>

      <div className="menu-rule" />

      <div className="bpm-panel-head">
        <span className="kicker">{t("setBpm.fromLength")}</span>
        <span className="bpm-panel-duration mono">
          {duration === "varies"
            ? t("setBpm.varies")
            : duration == null
              ? "—"
              : t("setBpm.seconds", { secs: (duration / 1000).toFixed(2) })}
        </span>
      </div>

      {hasLength ? (
        <>
          {BEAT_PRESETS.map((beats) => beatRow(beats, String(beats)))}
          <div className="bpm-panel-field custom">
            <input
              className="input input-mono bpm-panel-input"
              value={customBeats}
              inputMode="numeric"
              placeholder="12"
              aria-label={t("setBpm.customBeats")}
              onChange={(e) => {
                setCustomBeats(e.target.value);
              }}
              onKeyDown={(e) => {
                if (matchesBinding(e, keys.confirm) && customValid) onSetFromBeats(customCount);
              }}
            />
            <span className="bpm-panel-unit">{t("setBpm.customBeats")}</span>
            {customValid ? previewCells(preview(customCount)) : null}
          </div>
        </>
      ) : (
        <div className="bpm-panel-note">{t("setBpm.noDuration")}</div>
      )}

      <div className="menu-rule" />

      <Checkbox checked={round} onChange={onRoundChange}>
        {t("setBpm.round")}
      </Checkbox>

      <div className="menu-rule" />

      <button
        type="button"
        className="menu-item bpm-panel-clear danger"
        disabled={targets.every((sample) => sample.bpm == null)}
        onClick={onClear}
      >
        <TrashIcon size={13} />
        <span className="menu-label">{t("setBpm.clear")}</span>
      </button>
    </div>
  );
}
