import { FolderPlusIcon, XIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { AskIndexGroup } from "../lib/askIndex";

interface Props {
  groups: AskIndexGroup[];
  onRespond: (paths: string[], index: boolean) => void;
  onDismiss: () => void;
}

/** The non-blocking prompt pinned above the status bar. */
export function AskIndexToast({ groups, onRespond, onDismiss }: Props) {
  const { t } = useTranslation("library");
  const [first, ...rest] = groups;
  if (!first) return null;

  const allPaths = groups.flatMap((group) => group.paths);

  return (
    <div className="ask-toast" role="status">
      <FolderPlusIcon size={17} className="ask-toast-icon" />
      <div className="ask-toast-body">
        <div className="ask-toast-title">{t("askIndexTitle", { count: first.paths.length })}</div>
        <div className="ask-toast-path mono">{first.folder}</div>
        <div className="ask-toast-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              onRespond(first.paths, true);
            }}
          >
            {t("askIndex")}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              onRespond(first.paths, false);
            }}
          >
            {t("askSkip")}
          </button>
          {rest.length > 0 ? (
            <>
              <div className="ask-toast-divider" />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onRespond(allPaths, true);
                }}
              >
                {t("askIndexAll")}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onRespond(allPaths, false);
                }}
              >
                {t("askSkipAll")}
              </button>
            </>
          ) : null}
        </div>
        <div className="ask-toast-hint">
          {t("askIndexHint")}
          {rest.length > 0 ? ` ${t("askIndexQueued", { count: rest.length })}` : ""}
        </div>
      </div>
      <button
        type="button"
        className="ask-toast-close"
        aria-label={t("askSkip")}
        onClick={onDismiss}
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}
