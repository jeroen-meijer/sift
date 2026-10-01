import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { clampBpm, singleBpmRange } from "../../lib/omniQuery";
import { SEARCH_INPUT_ATTRS } from "../../lib/searchInputAttrs";
import { RangeSlider } from "../../ui/RangeSlider";
import { OmniEditorChrome } from "./OmniEditorChrome";
import { OmniToggle } from "./OmniToggle";

const HIST_LO = 40;
const HIST_HI = 200;
const HIST_BINS = 32;
const BIN_WIDTH = (HIST_HI - HIST_LO) / HIST_BINS;

export interface BpmEditorValue {
  min: number | null;
  max: number | null;
}

interface Props {
  value: BpmEditorValue;
  halfDouble: boolean;
  /** First keystroke in min also clears max (typed `b:` on an existing chip). */
  clearMaxOnMinEdit?: boolean;
  bpmValues: number[];
  onChange: (next: BpmEditorValue) => void;
  onToggleHalfDouble: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function binsFrom(values: number[]): number[] {
  const counts = Array.from({ length: HIST_BINS }, () => 0);
  for (const bpm of values) {
    if (bpm < HIST_LO || bpm > HIST_HI) continue;
    const i = Math.min(HIST_BINS - 1, Math.floor((bpm - HIST_LO) / BIN_WIDTH));
    counts[i] = (counts[i] ?? 0) + 1;
  }
  return counts;
}

export function BpmEditor({
  value,
  halfDouble,
  clearMaxOnMinEdit = false,
  bpmValues,
  onChange,
  onToggleHalfDouble,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation("common");
  const minRef = useRef<HTMLInputElement>(null);
  const maxRef = useRef<HTMLInputElement>(null);
  const [minText, setMinText] = useState(value.min != null ? String(value.min) : "");
  const [maxText, setMaxText] = useState(value.max != null ? String(value.max) : "");
  const clearedMax = useRef(false);
  const bins = binsFrom(bpmValues);
  const maxCount = Math.max(1, ...bins);

  useEffect(() => {
    minRef.current?.focus();
    minRef.current?.select();
  }, []);

  const apply = (minStr: string, maxStr: string) => {
    const minN = minStr === "" ? null : clampBpm(Number(minStr));
    const maxN = maxStr === "" ? null : clampBpm(Number(maxStr));
    if (minN != null && maxStr === "" && minStr !== "") {
      /* Live preview: single value → ±2. */
      const range = singleBpmRange(minN);
      onChange({ min: range.min, max: range.max });
      return;
    }
    if (minN != null && maxN != null && minN > maxN) {
      onChange({ min: maxN, max: minN });
      return;
    }
    onChange({ min: minN, max: maxN });
  };

  const syntax =
    value.min != null && value.max != null
      ? value.min === value.max
        ? `b:${String(value.min)}`
        : `b:${String(value.min)}-${String(value.max)}`
      : value.min != null
        ? `b:${String(value.min)}`
        : "b:";

  const inRange = (binIndex: number) => {
    if (value.min == null && value.max == null) return false;
    const lo = HIST_LO + binIndex * BIN_WIDTH;
    const hi = lo + BIN_WIDTH;
    const min = value.min ?? HIST_LO;
    const max = value.max ?? HIST_HI;
    return hi > min && lo < max;
  };

  const sliderLow = value.min ?? HIST_LO;
  const sliderHigh = value.max ?? HIST_HI;

  return (
    <OmniEditorChrome
      keysHint={t("omni.editor.bpmKeys")}
      syntax={syntax}
      header={
        <OmniToggle on={halfDouble} label={t("omni.halfDouble")} onToggle={onToggleHalfDouble} />
      }
    >
      <div className="omni-bpm-fields">
        <input
          ref={minRef}
          className="omni-bpm-input mono"
          inputMode="numeric"
          maxLength={3}
          {...SEARCH_INPUT_ATTRS}
          value={minText}
          aria-label={t("omni.editor.bpmMin")}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
            setMinText(digits);
            let nextMax = maxText;
            if (clearMaxOnMinEdit && !clearedMax.current) {
              clearedMax.current = true;
              nextMax = "";
              setMaxText("");
            }
            apply(digits, nextMax);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
              return;
            }
            if (e.key === "h" || e.key === "H") {
              e.preventDefault();
              onToggleHalfDouble();
              return;
            }
            if (e.key === "Tab" || e.key === "-" || e.key === "–") {
              e.preventDefault();
              maxRef.current?.focus();
              maxRef.current?.select();
              return;
            }
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onConfirm();
            }
          }}
        />
        <span className="omni-bpm-sep">–</span>
        <input
          ref={maxRef}
          className="omni-bpm-input mono"
          inputMode="numeric"
          maxLength={3}
          {...SEARCH_INPUT_ATTRS}
          value={maxText}
          aria-label={t("omni.editor.bpmMax")}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
            setMaxText(digits);
            apply(minText, digits);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
              return;
            }
            if (e.key === "h" || e.key === "H") {
              e.preventDefault();
              onToggleHalfDouble();
              return;
            }
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              onConfirm();
              return;
            }
            if (e.key === "Tab" && e.shiftKey) {
              e.preventDefault();
              minRef.current?.focus();
              minRef.current?.select();
              return;
            }
            if (e.key === "Backspace" && maxText === "") {
              e.preventDefault();
              minRef.current?.focus();
              minRef.current?.select();
              return;
            }
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onConfirm();
            }
          }}
        />
        {maxText === "" && minText !== "" ? (
          <span className="omni-bpm-slack">{t("omni.editor.bpmSlack")}</span>
        ) : null}
      </div>

      <div className="omni-bpm-hist" aria-hidden>
        {bins.map((count, i) => (
          <div
            key={i}
            className={`omni-bpm-bin${inRange(i) ? " in" : ""}`}
            style={{ height: `${Math.max(4, (count / maxCount) * 100)}%` }}
          />
        ))}
      </div>

      <RangeSlider
        min={HIST_LO}
        max={HIST_HI}
        low={sliderLow}
        high={sliderHigh}
        lowLabel={t("omni.editor.bpmMin")}
        highLabel={t("omni.editor.bpmMax")}
        onChange={(low, high) => {
          setMinText(String(low));
          setMaxText(String(high));
          onChange({ min: low, max: high });
        }}
      />
    </OmniEditorChrome>
  );
}
