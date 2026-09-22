import { CircleNotchIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export interface AnalysisBar {
  done: number;
  total: number;
}

interface Props {
  rootCount: number;
  fileCount: number;
  shownCount?: number | undefined;
  statusText?: string | undefined;
  analysis?: AnalysisBar | null | undefined;
}

export function StatusBar({
  rootCount,
  fileCount,
  shownCount,
  statusText,
  analysis,
}: Props) {
  const { t } = useTranslation("common");
  const pct =
    analysis && analysis.total > 0
      ? Math.min(100, Math.round((analysis.done / analysis.total) * 100))
      : 0;

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        {shownCount != null ? (
          <>
            <span>{t("statusShown", { shown: shownCount, total: fileCount })}</span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <span>{t("statusRoots", { count: rootCount })}</span>
        <span aria-hidden>·</span>
        <span>{t("statusFiles", { count: fileCount })}</span>
        {statusText && !analysis ? (
          <>
            <span aria-hidden>·</span>
            <span>{statusText}</span>
          </>
        ) : null}
      </div>
      {analysis ? (
        <div className="statusbar-analysis">
          <CircleNotchIcon size={12} className="statusbar-spin" weight="bold" />
          <span>
            {t("statusAnalyzingProgress", {
              done: analysis.done,
              total: analysis.total,
            })}
          </span>
          <div className="statusbar-bar" aria-hidden>
            <div className="statusbar-bar-fill" style={{ width: `${String(pct)}%` }} />
          </div>
          <span className="statusbar-hint">{t("statusBrowseWhile")}</span>
        </div>
      ) : null}
    </footer>
  );
}
