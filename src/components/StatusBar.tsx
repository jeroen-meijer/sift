import { useTranslation } from "react-i18next";

type Props = {
  rootCount: number;
  fileCount: number;
  statusText?: string;
};

export function StatusBar({ rootCount, fileCount, statusText }: Props) {
  const { t } = useTranslation("common");

  return (
    <footer className="statusbar">
      <span>{t("statusRoots", { count: rootCount })}</span>
      <span aria-hidden>·</span>
      <span>{t("statusFiles", { count: fileCount })}</span>
      {statusText ? (
        <>
          <span aria-hidden>·</span>
          <span>{statusText}</span>
        </>
      ) : null}
    </footer>
  );
}
