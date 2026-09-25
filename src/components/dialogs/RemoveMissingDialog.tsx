import { BroomIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { SampleRow } from "../../lib/ipc";
import { Dialog, DialogActionButton, DialogDismissButton } from "../../ui/Dialog";

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
    <Dialog width={452} label={t("removeMissing.title", { count: 1 })} onClose={onCancel}>
      <div className="dialog-head">
        <WarningIcon size={19} className="dialog-icon-danger" />
        <div>
          <h2 className="dialog-title">{t("removeMissing.title", { count: 1 })}</h2>
          <p className="dialog-body">{t("removeMissing.body")}</p>
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
          <span>{t("removeMissing.others", { count: otherMissing })}</span>
          <DialogActionButton className="link-button" onClick={onRemoveAll}>
            {t("removeMissing.removeAll")}
          </DialogActionButton>
        </div>
      ) : null}

      <div className="dialog-actions">
        <DialogDismissButton className="btn btn-secondary">{tc("action.cancel")}</DialogDismissButton>
        <DialogActionButton className="btn btn-danger" onClick={onConfirm}>
          {t("removeMissing.confirm")}
        </DialogActionButton>
      </div>
    </Dialog>
  );
}
