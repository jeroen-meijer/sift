import { PauseIcon, PlayIcon, RepeatIcon } from "@phosphor-icons/react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { keys } from "../lib/bindings";
import { formatDb, formatTransportTime } from "../lib/format";
import type { SnapMode } from "../lib/ipc";
import { playheadStore } from "../lib/liveStores";
import { PillSelect } from "../ui/PillSelect";
import { Slider } from "../ui/Slider";

interface Props {
  /** Duration in seconds. 0 when unknown. */
  durationSecs: number;
  playing: boolean;
  canPlay: boolean;
  /** Playhead is on this sample (playing or paused mid-file). */
  playheadActive: boolean;
  onPlayPause: () => void;
  snap: SnapMode;
  onSnapChange: (snap: SnapMode) => void;
  loopPreview: boolean;
  onLoopChange: (on: boolean) => void;
  gainDb: number;
  onGainChange: (db: number) => void;
}

/** Left half of the transport clock. Writes from `playheadStore` with no React updates. */
function TransportPosition({ durationSecs, active }: { durationSecs: number; active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const secs = active ? (playheadStore.get() ?? 0) : 0;
      const clamped =
        durationSecs > 0 ? Math.min(Math.max(0, secs), durationSecs) : Math.max(0, secs);
      el.textContent = formatTransportTime(clamped);
    };
    apply();
    if (!active) return;
    return playheadStore.subscribe(apply);
  }, [active, durationSecs]);
  return <span ref={ref}>{formatTransportTime(0)}</span>;
}

export function TransportBar({
  durationSecs,
  playing,
  canPlay,
  playheadActive,
  onPlayPause,
  snap,
  onSnapChange,
  loopPreview,
  onLoopChange,
  gainDb,
  onGainChange,
}: Props) {
  const { t } = useTranslation("library");
  const snapOptions = useMemo(
    (): { value: SnapMode; label: string }[] => [
      { value: "None", label: t("transport.snapNone") },
      { value: "1/4", label: t("transport.snapQuarter") },
      { value: "1/8", label: t("transport.snapEighth") },
      { value: "1/16", label: t("transport.snapSixteenth") },
    ],
    [t],
  );

  return (
    <div className="transport">
      <div className="transport-group transport-playback">
        <button
          type="button"
          className="transport-play"
          aria-label={playing ? t("transport.pause") : t("transport.play")}
          disabled={!canPlay}
          onClick={onPlayPause}
        >
          {playing ? (
            <PauseIcon size={12} weight="fill" />
          ) : (
            <PlayIcon size={11} weight="fill" className="transport-play-icon" />
          )}
        </button>
        <span className="transport-time mono" aria-live="off">
          <TransportPosition durationSecs={durationSecs} active={playheadActive} />
          <span className="transport-time-sep"> / </span>
          <span>{formatTransportTime(durationSecs)}</span>
        </span>
      </div>

      <div className="transport-rule" aria-hidden />

      <div className="transport-group">
        <span className="transport-label">{t("transport.snap")}</span>
        <PillSelect label={t("transport.snap")} value={snap} options={snapOptions} onChange={onSnapChange} />
      </div>

      <button
        type="button"
        className={`transport-toggle${loopPreview ? " on" : ""}`}
        aria-pressed={loopPreview}
        onClick={() => {
          onLoopChange(!loopPreview);
        }}
      >
        <RepeatIcon size={12} weight={loopPreview ? "fill" : "regular"} />
        {t("transport.loopPreview")}
      </button>

      <div className="transport-rule" aria-hidden />

      <div className="transport-group">
        <span className="transport-label">{t("transport.previewGain")}</span>
        <Slider
          label={t("transport.previewGain")}
          value={gainDb}
          min={-24}
          max={6}
          step={0.5}
          onChange={onGainChange}
        />
        <span className="transport-gain mono">{formatDb(gainDb)}</span>
      </div>

      <div className="transport-hints">
        <span>
          <em>{keys.play.hint}</em> {t("transport.hint.playStart")}
        </span>
        <span>
          <em>{keys.pause.hint}</em> {t("transport.hint.pause")}
        </span>
        <span>
          <em>{keys.freeTime.hint}drag</em> {t("transport.hint.freeTime")}
        </span>
        <span>
          <em>{keys.zeroCrossing.hint}</em> {t("transport.hint.zeroCross")}
        </span>
      </div>
    </div>
  );
}
