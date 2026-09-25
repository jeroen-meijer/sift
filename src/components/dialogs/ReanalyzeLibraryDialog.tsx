import { WarningIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogActionButton, DialogDismissButton } from "../../ui/Dialog";

interface Props {
  onCancel: () => void;
  onConfirm: () => void;
}

export function ReanalyzeLibraryDialog({ onCancel, onConfirm }: Props) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");

  return (
    <Dialog width={452} label={t("reanalyzeLibraryTitle")} onClose={onCancel}>
      <div className="dialog-head">
        <WarningIcon size={19} className="dialog-icon-danger" />
        <div>
          <h2 className="dialog-title">{t("reanalyzeLibraryTitle")}</h2>
          <p className="dialog-body">{t("reanalyzeLibraryBody")}</p>
        </div>
      </div>

      <div className="dialog-actions">
        <DialogDismissButton className="btn btn-secondary">{tc("cancel")}</DialogDismissButton>
        <DialogActionButton className="btn btn-danger" onClick={onConfirm}>
          {t("reanalyzeLibraryConfirm")}
        </DialogActionButton>
      </div>
    </Dialog>
  );
}
