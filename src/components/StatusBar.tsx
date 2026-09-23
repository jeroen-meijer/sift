import { CircleNotchIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { memo } from "react";
import { formatCount } from "../lib/format";
import { analysisStore } from "../lib/liveStores";
import { useStoreSelector } from "../lib/store";

export type { AnalysisBar } from "../lib/liveStores";

interface Props {
  rootCount: number;
  fileCount: number;
  /** Rows the current query shows. Omitted on first launch. */
  shownCount?: number | undefined;
  /** True while the omni bar holds a query, which switches the count to "N results". */
  filtered?: boolean;
  statusText?: string | undefined;
}

/** Analysis progress comes from `analysisStore`, so progress ticks re-render only this bar. */
export const StatusBar = memo(function StatusBar({
  rootCount,
  fileCount,
  shownCount,
  filtered = false,
  statusText,
}: Props) {
  const { t } = useTranslation("common");
  const analysis = useStoreSelector(analysisStore, (s) => s.bar);
  const pct =
    analysis && analysis.total > 0
      ? Math.min(100, Math.round((analysis.done / analysis.total) * 100))
      : 0;

  const lead =
    shownCount == null
      ? null
      : filtered
        ? t("statusResults", { count: shownCount })
        : t("statusShown", { shown: formatCount(shownCount), total: formatCount(fileCount) });

  return (
    <footer className="statusbar">
      <div className="statusbar-left">
        {lead ? (
          <>
            <span className="statusbar-lead">{lead}</span>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <span>{t("statusRoots", { count: rootCount })}</span>
        <span aria-hidden>·</span>
        <span>
          {t(shownCount == null ? "statusFilesIndexed" : "statusFiles", {
            count: fileCount,
            formatted: formatCount(fileCount),
          })}
        </span>
        {statusText && !analysis ? (
          <>
            <span aria-hidden>·</span>
            <span>{statusText}</span>
          </>
        ) : null}
      </div>
      {analysis ? (
        <div className="statusbar-analysis">
          <CircleNotchIcon size={12} className="statusbar-spin" />
          <span className="statusbar-analysis-label">
            {t("statusAnalyzingLocal")}
          </span>
          <div className="statusbar-bar" aria-hidden>
            <div className="statusbar-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="statusbar-hint">
            {t("statusAnalyzingProgress", {
              done: formatCount(analysis.done),
              total: formatCount(analysis.total),
            })}
          </span>
        </div>
      ) : null}
    </footer>
  );
});
