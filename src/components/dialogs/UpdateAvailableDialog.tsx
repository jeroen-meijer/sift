import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  installAvailableUpdate,
  type AvailableUpdate,
} from "../../lib/updates";
import { Dialog } from "../../ui/Dialog";

interface Props {
  available: AvailableUpdate;
  onDismiss: () => void;
}

export function UpdateAvailableDialog({ available, onDismiss }: Props) {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = () => {
    if (installing) return;
    setInstalling(true);
    setError(null);
    void installAvailableUpdate(available).catch((err: unknown) => {
      setInstalling(false);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <Dialog width={452} label={t("updateAvailableTitle")} onClose={onDismiss}>
      <div className="dialog-head">
        <DownloadSimpleIcon size={19} />
        <div>
          <h2 className="dialog-title">{t("updateAvailableTitle")}</h2>
          <p className="dialog-body">
            {t("updateAvailableBody", { version: available.version })}
          </p>
          {available.notes ? (
            <p className="dialog-body settings-update-notes">{available.notes}</p>
          ) : null}
          {error ? <p className="dialog-body settings-update-error">{error}</p> : null}
        </div>
      </div>

      <div className="dialog-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={installing}
          onClick={onDismiss}
        >
          {tc("cancel")}
        </button>
        <button type="button" className="btn btn-primary" disabled={installing} onClick={install}>
          {installing ? t("updateInstalling") : t("updateInstall")}
        </button>
      </div>
    </Dialog>
  );
}
