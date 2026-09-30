import { WarningCircleIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogActionButton } from "../../ui/Dialog";

export type OverlapReason = "nested" | "containsExisting";

interface Props {
  reason: OverlapReason;
  newLabel: string;
  existingLabel: string;
  onClose: () => void;
}

/** Blocking dialog when add-folder is refused because paths overlap. */
export function OverlapFolderDialog({ reason, newLabel, existingLabel, onClose }: Props) {
  const { t } = useTranslation("library");
  const bodyKey =
    reason === "nested" ? "overlapFolder.bodyNested" : "overlapFolder.bodyContains";

  return (
    <Dialog width={452} label={t("overlapFolder.title")} onClose={onClose}>
      <div className="dialog-head">
        <WarningCircleIcon size={19} className="dialog-icon-accent" />
        <div>
          <h2 className="dialog-title">{t("overlapFolder.title")}</h2>
          <p className="dialog-body">
            {t(bodyKey, { newName: newLabel, existingName: existingLabel })}
          </p>
        </div>
      </div>

      <div className="dialog-actions">
        <DialogActionButton className="btn btn-primary" onClick={onClose}>
          {t("overlapFolder.ok")}
        </DialogActionButton>
      </div>
    </Dialog>
  );
}
