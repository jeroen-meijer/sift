import { WarningIcon } from "@phosphor-icons/react";
import { Trans, useTranslation } from "react-i18next";
import { formatCount } from "../../lib/format";
import type { TagNode } from "../../lib/ipc";
import { Dialog, DialogActionButton, DialogDismissButton } from "../../ui/Dialog";

interface Props {
  tag: TagNode;
  /** The tag and every descendant, in path order. */
  targets: TagNode[];
  onCancel: () => void;
  onConfirm: () => void;
}

export function TagDeleteDialog({ tag, targets, onCancel, onConfirm }: Props) {
  const { t } = useTranslation("tags");
  const { t: tc } = useTranslation("common");
  const cascade = targets.length > 1;
  const samples = targets.reduce((sum, node) => sum + node.sample_count, 0);
  const rootDepth = tag.path.split("/").length;

  return (
    <Dialog width={452} label={t("editor.delete.title")} onClose={onCancel}>
      <div className="dialog-head">
        <WarningIcon size={19} className="dialog-icon-danger" />
        <div>
          <h2 className="dialog-title">
            <Trans
              t={t}
              i18nKey={cascade ? "deleteDialog.cascade.title" : "deleteDialog.simple.title"}
              values={{ name: tag.path }}
              components={[<span className="mono" key="name" />]}
            />
          </h2>
          <p className="dialog-body">
            {cascade ? (
              <Trans
                t={t}
                i18nKey="deleteDialog.cascade.body"
                values={{
                  children: targets.length - 1,
                  samples: formatCount(samples),
                }}
                components={[<strong key="v" />]}
              />
            ) : (
              t("deleteDialog.simple.body", { count: tag.sample_count })
            )}
          </p>
        </div>
      </div>

      {cascade ? (
        <div className="dialog-panel danger">
          <div className="kicker dialog-panel-kicker">{t("deleteDialog.willBeDeleted")}</div>
          <div className="delete-list mono">
            {targets.map((node) => (
              <span
                key={node.id}
                style={{ paddingLeft: (node.path.split("/").length - rootDepth) * 15 }}
              >
                {node.path} <span className="delete-list-count">· {formatCount(node.sample_count)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="dialog-actions">
        <span className="dialog-note">{t("deleteDialog.filesUntouched")}</span>
        <DialogDismissButton className="btn btn-secondary">{tc("action.cancel")}</DialogDismissButton>
        <DialogActionButton className="btn btn-danger" onClick={onConfirm}>
          {t("deleteDialog.confirm", { count: targets.length })}
        </DialogActionButton>
      </div>
    </Dialog>
  );
}
