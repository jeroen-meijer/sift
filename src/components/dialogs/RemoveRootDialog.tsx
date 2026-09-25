import { FolderIcon, HardDrivesIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { Trans, useTranslation } from "react-i18next";
import { formatCount } from "../../lib/format";
import { Dialog, DialogActionButton, DialogDismissButton } from "../../ui/Dialog";

interface Props {
  path: string;
  sampleCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RemoveRootDialog({ path, sampleCount, onCancel, onConfirm }: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");

  return (
    <Dialog width={452} label={t("removeRootTitle")} onClose={onCancel}>
      <div className="dialog-head">
        <HardDrivesIcon size={19} className="dialog-icon-accent" />
        <div>
          <h2 className="dialog-title">{t("removeRootTitle")}</h2>
          <p className="dialog-body">
            <Trans
              t={t}
              i18nKey="removeRootBody"
              count={sampleCount}
              values={{ formatted: formatCount(sampleCount) }}
              components={[<strong key="count" />]}
            />
          </p>
        </div>
      </div>

      <div className="dialog-panel dialog-path-row">
        <FolderIcon size={15} />
        <span className="mono">{path}</span>
      </div>

      <div className="dialog-safe-note">
        <ShieldCheckIcon size={15} weight="fill" />
        <span>{t("removeRootSafe")}</span>
      </div>

      <div className="dialog-actions">
        <DialogDismissButton className="btn btn-secondary">{tc("cancel")}</DialogDismissButton>
        <DialogActionButton className="btn btn-danger" onClick={onConfirm}>
          {t("removeRootConfirm")}
        </DialogActionButton>
      </div>
    </Dialog>
  );
}
