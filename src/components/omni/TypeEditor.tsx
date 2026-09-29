import { LightningIcon, RepeatIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { SampleTypeFilter } from "../../lib/omni";
import { OmniEditorChrome } from "./OmniEditorChrome";

interface Props {
  value: SampleTypeFilter;
  onChange: (next: SampleTypeFilter) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function TypeEditor({ value, onChange, onConfirm, onCancel }: Props) {
  const { t } = useTranslation("common");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const selected: "loop" | "one-shot" = value === "one-shot" ? "one-shot" : "loop";
  const syntax = `type:${selected}`;

  return (
    <OmniEditorChrome keysHint={t("omni.editor.typeKeys")} syntax={syntax}>
      <div
        ref={ref}
        className="omni-type-editor"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === "l" || e.key === "L") {
            e.preventDefault();
            onChange("loop");
            return;
          }
          if (e.key === "o" || e.key === "O") {
            e.preventDefault();
            onChange("one-shot");
            return;
          }
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            onChange(selected === "loop" ? "one-shot" : "loop");
            return;
          }
          if (e.key === "Enter" || e.key === "Tab" || e.key === " ") {
            e.preventDefault();
            onConfirm();
          }
        }}
      >
        <span className="omni-editor-label">{t("omni.chip.type")}</span>
        <div className="omni-type-picks">
          <button
            type="button"
            className={`omni-type-pick${selected === "loop" ? " on" : ""}`}
            onClick={() => {
              onChange("loop");
            }}
          >
            <RepeatIcon size={13} />
            {t("omni.type.loops")}
            <span className="mono">L</span>
          </button>
          <button
            type="button"
            className={`omni-type-pick${selected === "one-shot" ? " on" : ""}`}
            onClick={() => {
              onChange("one-shot");
            }}
          >
            <LightningIcon size={13} />
            {t("omni.type.oneShots")}
            <span className="mono">O</span>
          </button>
        </div>
      </div>
    </OmniEditorChrome>
  );
}
