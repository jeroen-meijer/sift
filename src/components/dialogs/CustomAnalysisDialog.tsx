import { Trans, useTranslation } from "react-i18next";
import type { CustomAnalysisOpts } from "../../lib/ipc";
import { Checkbox } from "../../ui/Checkbox";
import { Dialog } from "../../ui/Dialog";
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
    <Dialog width={492} label={t("customAnalysis")} onClose={onCancel}>
      <h2 className="dialog-title dialog-title-lg">{t("customAnalysis")}</h2>
      <p className="dialog-body dialog-body-spaced">
        <Trans
          t={t}
          i18nKey="customAnalysisBody"
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
          {t("rerunBpm")}
        </Checkbox>
        <Checkbox
          checked={opts.rerun_key}
          onChange={(rerun_key) => {
            onOptsChange({ ...opts, rerun_key });
          }}
        >
          {t("rerunKey")}
        </Checkbox>
        <Checkbox
          checked={opts.rerun_type}
          onChange={(rerun_type) => {
            onOptsChange({ ...opts, rerun_type });
          }}
        >
          {t("rerunType")}
        </Checkbox>
        <Checkbox
          checked={opts.overwrite_tags}
          hint={t("overwriteTagsHint")}
          onChange={(overwrite_tags) => {
            onOptsChange({ ...opts, overwrite_tags });
          }}
        >
          {t("overwriteTags")}
        </Checkbox>
      </div>

      <div className="dialog-panel">
        <div className="dialog-panel-head">
          <span className="kicker">{t("bpmRangeShort")}</span>
          <span className="dialog-panel-note">{t("bpmRangeShared")}</span>
        </div>
        <BpmRangePicker min={bpmMin} max={bpmMax} onChange={onBpmRangeChange} withSlider />
      </div>

      <div className="dialog-actions">
        <span className="dialog-note">{t("analyzeBackground")}</span>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {tc("cancel")}
        </button>
        <button type="button" className="btn btn-primary" onClick={onRun} disabled={count === 0}>
          {t("analyzeN", { count })}
        </button>
      </div>
    </Dialog>
  );
}
