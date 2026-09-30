import { HardDrivesIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { getVersion } from "@tauri-apps/api/app";
import { exit } from "@tauri-apps/plugin-process";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isApplePlatform } from "../../lib/bindings";
import { CopyableText } from "../../ui/CopyableText";
import { Dialog, DialogDismissButton } from "../../ui/Dialog";

interface Props {
  backupPath: string;
  migrateError: string;
  onContinue: () => void;
}

function buildErrorDetails(version: string, backupPath: string, migrateError: string): string {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const os = uaData?.platform ?? "unknown";
  return [
    "Sift couldn't open your library.",
    "",
    `App: ${version}`,
    `OS: ${os}`,
    `Backup: ${backupPath}`,
    `Error: ${migrateError}`,
  ].join("\n");
}

/** Blocking dialog when boot renamed a broken library and opened a fresh empty one. */
export function LibraryRecoveryDialog({ backupPath, migrateError, onContinue }: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");
  const [version, setVersion] = useState("?");

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {
        setVersion("?");
      });
  }, []);

  const revealLabel = isApplePlatform() ? tc("menu.reveal") : tc("menu.revealWindows");

  return (
    <Dialog width={480} label={t("recovery.title")} onClose={onContinue}>
      <div className="dialog-head">
        <WarningCircleIcon size={19} className="dialog-icon-accent" />
        <div>
          <h2 className="dialog-title">{t("recovery.title")}</h2>
          <p className="dialog-body">{t("recovery.body")}</p>
          <p className="dialog-body">{t("recovery.backupIntro")}</p>
        </div>
      </div>

      <div className="dialog-panel dialog-path-row">
        <HardDrivesIcon size={15} />
        <CopyableText text={backupPath} />
      </div>

      <div className="dialog-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void revealItemInDir(backupPath).catch(console.error);
          }}
        >
          {revealLabel}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            const payload = buildErrorDetails(version, backupPath, migrateError);
            void navigator.clipboard.writeText(payload).catch(console.error);
          }}
        >
          {t("recovery.copyError")}
        </button>
        <DialogDismissButton className="btn btn-secondary">{t("recovery.continue")}</DialogDismissButton>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            void exit(0);
          }}
        >
          {t("recovery.quit")}
        </button>
      </div>
    </Dialog>
  );
}
