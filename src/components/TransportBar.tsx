import { RepeatIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { keys } from "../lib/bindings";
import { formatDb } from "../lib/format";
import type { SnapMode } from "../lib/ipc";
import { PillSelect } from "../ui/PillSelect";
import { Slider } from "../ui/Slider";

const SNAP_OPTIONS: { value: SnapMode; label: string }[] = [
  { value: "None", label: "None" },
  { value: "1/4", label: "1/4" },
  { value: "1/8", label: "1/8" },
  { value: "1/16", label: "1/16" },
];

interface Props {
  snap: SnapMode;
  onSnapChange: (snap: SnapMode) => void;
  loopPreview: boolean;
  onLoopChange: (on: boolean) => void;
  gainDb: number;
  onGainChange: (db: number) => void;
}

export function TransportBar({
  snap,
  onSnapChange,
  loopPreview,
  onLoopChange,
  gainDb,
  onGainChange,
}: Props) {
  const { t } = useTranslation("library");

  return (
    <div className="transport">
      <div className="transport-group">
        <span className="transport-label">{t("snap")}</span>
        <PillSelect label={t("snap")} value={snap} options={SNAP_OPTIONS} onChange={onSnapChange} />
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
        {t("loopPreview")}
      </button>

      <div className="transport-group">
        <span className="transport-label">{t("previewGain")}</span>
        <Slider
          label={t("previewGain")}
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
          <em>{keys.play.hint}</em> {t("hintPlayStart")}
        </span>
        <span>
          <em>{keys.pause.hint}</em> {t("hintPause")}
        </span>
        <span>
          <em>{keys.freeTime.hint}drag</em> {t("hintFreeTime")}
        </span>
        <span>
          <em>{keys.zeroCrossing.hint}</em> {t("hintZeroCross")}
        </span>
      </div>
    </div>
  );
}
