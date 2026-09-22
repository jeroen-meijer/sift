import { BroomIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { SampleRow } from "../../lib/ipc";
import { Dialog } from "../../ui/Dialog";

interface Props {
  sample: SampleRow;
  /** Missing samples in the library other than this one. */
  otherMissing: number;
  onCancel: () => void;
  onConfirm: () => void;
  onRemoveAll: () => void;
}

export function RemoveMissingDialog({
  sample,
  otherMissing,
  onCancel,
  onConfirm,
  onRemoveAll,
}: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");

  return (
    <Dialog width={452} label={t("removeMissingTitle", { count: 1 })} onClose={onCancel}>
      <div className="dialog-head">
        <WarningIcon size={19} className="dialog-icon-danger" />
        <div>
          <h2 className="dialog-title">{t("removeMissingTitle", { count: 1 })}</h2>
          <p className="dialog-body">{t("removeMissingBody")}</p>
        </div>
      </div>

      <div className="dialog-panel dialog-path-row">
        <WarningCircleIcon size={15} weight="fill" className="dialog-icon-danger" />
        <div className="dialog-file">
          <div className="mono dialog-file-name">{sample.filename}</div>
          <div className="mono dialog-file-path">{sample.parent_path}</div>
        </div>
      </div>

      {otherMissing > 0 ? (
        <div className="dialog-inline-note">
          <BroomIcon size={15} />
          <span>{t("removeMissingOthers", { count: otherMissing })}</span>
          <button type="button" className="link-button" onClick={onRemoveAll}>
            {t("removeAllMissing")}
          </button>
        </div>
      ) : null}

      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {tc("cancel")}
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>
          {t("removeMissingConfirm")}
        </button>
      </div>
    </Dialog>
  );
}
