import { Trans, useTranslation } from "react-i18next";
import type { CustomAnalysisOpts } from "../../lib/ipc";
import { Checkbox } from "../../ui/Checkbox";
import { Dialog, DialogActionButton, DialogDismissButton } from "../../ui/Dialog";
import { BpmRangePicker } from "../BpmRangePicker";

interface Props {
  count: number;
  opts: CustomAnalysisOpts;
  onOptsChange: (opts: CustomAnalysisOpts) => void;
  bpmMin: number;
  bpmMax: number;
  onBpmRangeChange: (min: number, max: number) => void;
  onCancel: () => void;
  onRun: () => void;
}

export function CustomAnalysisDialog({
  count,
  opts,
  onOptsChange,
  bpmMin,
  bpmMax,
  onBpmRangeChange,
  onCancel,
  onRun,
}: Props) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");

  return (
    <Dialog width={492} label={t("analysis.custom.title")} onClose={onCancel}>
      <h2 className="dialog-title dialog-title-lg">{t("analysis.custom.title")}</h2>
      <p className="dialog-body dialog-body-spaced">
        <Trans
          t={t}
          i18nKey="analysis.custom.body"
          count={count}
          components={[<strong key="count" />]}
        />
      </p>

      <div className="checkbox-stack">
        <Checkbox
          checked={opts.rerun_bpm}
          onChange={(rerun_bpm) => {
            onOptsChange({ ...opts, rerun_bpm });
          }}
        >
          {t("analysis.custom.rerunBpm")}
        </Checkbox>
        <Checkbox
          checked={opts.rerun_key}
          onChange={(rerun_key) => {
            onOptsChange({ ...opts, rerun_key });
          }}
        >
          {t("analysis.custom.rerunKey")}
        </Checkbox>
        <Checkbox
          checked={opts.rerun_type}
          onChange={(rerun_type) => {
            onOptsChange({ ...opts, rerun_type });
          }}
        >
          {t("analysis.custom.rerunType")}
        </Checkbox>
        <Checkbox
          checked={opts.overwrite_tags}
          hint={t("analysis.custom.overwriteTags.hint")}
          onChange={(overwrite_tags) => {
            onOptsChange({ ...opts, overwrite_tags });
          }}
        >
          {t("analysis.custom.overwriteTags.label")}
        </Checkbox>
      </div>

      <div className="dialog-panel">
        <div className="dialog-panel-head">
          <span className="kicker">{t("analysis.bpmRange.short")}</span>
          <span className="dialog-panel-note">{t("analysis.bpmRange.shared")}</span>
        </div>
        <BpmRangePicker min={bpmMin} max={bpmMax} onChange={onBpmRangeChange} withSlider />
      </div>

      <div className="dialog-actions">
        <span className="dialog-note">{t("analysis.custom.background")}</span>
        <DialogDismissButton className="btn btn-secondary">{tc("action.cancel")}</DialogDismissButton>
        <DialogActionButton
          className="btn btn-primary"
          onClick={onRun}
          disabled={count === 0}
        >
          {t("analysis.custom.analyze", { count })}
        </DialogActionButton>
      </div>
    </Dialog>
  );
}
