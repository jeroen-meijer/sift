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
}

/** Work progress comes from `analysisStore`, so ticks re-render only this bar. */
export const StatusBar = memo(function StatusBar({
  rootCount,
  fileCount,
  shownCount,
  filtered = false,
}: Props) {
  const { t } = useTranslation("common");
  const analysis = useStoreSelector(analysisStore, (s) => s.bar);
  const indeterminate = analysis?.total === 0;
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
      </div>
      {analysis ? (
        <div className="statusbar-analysis">
          <CircleNotchIcon size={12} className="statusbar-spin" />
          <div className={`statusbar-bar${indeterminate ? " indeterminate" : ""}`} aria-hidden>
            <div
              className="statusbar-bar-fill"
              style={indeterminate ? undefined : { width: `${pct}%` }}
            />
          </div>
          <span className="statusbar-hint">
            {indeterminate
              ? t("statusProcessingCount", { done: formatCount(analysis.done) })
              : t("statusProcessingProgress", {
                  done: formatCount(analysis.done),
                  total: formatCount(analysis.total),
                })}
          </span>
        </div>
      ) : null}
    </footer>
  );
});
