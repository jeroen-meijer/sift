import { useTranslation } from "react-i18next";
import { BPM_CEILING, BPM_FLOOR, BPM_PRESETS } from "../lib/bpmPresets";
import { RangeSlider } from "../ui/RangeSlider";

interface Props {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
  /** The dialog shows number inputs and a slider; Settings shows chips only. */
  withSlider?: boolean;
  showDefaultNote?: boolean;
}

export function BpmRangePicker({
  min,
  max,
  onChange,
  withSlider = false,
  showDefaultNote = false,
}: Props) {
  const { t } = useTranslation("settings");

  return (
    <>
      <div className="chip-row">
        {BPM_PRESETS.map((preset) => (
          <button
            key={preset.labelKey}
            type="button"
            className={`preset-chip${min === preset.min && max === preset.max ? " on" : ""}`}
            onClick={() => {
              onChange(preset.min, preset.max);
            }}
          >
            {t(preset.labelKey)}
            {showDefaultNote && preset.isDefault ? (
              <span className="chip-note"> {t("analysis.bpmRange.default")}</span>
            ) : null}
          </button>
        ))}
      </div>

      {withSlider ? (
        <div className="bpm-range-row">
          <input
            className="input input-mono bpm-range-input"
            aria-label={t("analysis.bpmRange.min")}
            value={min}
            inputMode="numeric"
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) onChange(Math.min(next, max), max);
            }}
          />
          <RangeSlider
            min={BPM_FLOOR}
            max={BPM_CEILING}
            low={min}
            high={max}
            lowLabel={t("analysis.bpmRange.min")}
            highLabel={t("analysis.bpmRange.max")}
            onChange={onChange}
          />
          <input
            className="input input-mono bpm-range-input"
            aria-label={t("analysis.bpmRange.max")}
            value={max}
            inputMode="numeric"
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) onChange(min, Math.max(next, min));
            }}
          />
        </div>
      ) : null}
    </>
  );
}
