import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { flattenTags, type TagNode } from "../../lib/ipc";
import { tagPalette } from "../../lib/tagColors";
import { Checkbox } from "../../ui/Checkbox";
import { Dialog, DialogDismissButton } from "../../ui/Dialog";

interface Props {
  tags: TagNode[];
  /** Tag ids already on every selected sample. */
  checkedIds: Set<number>;
  sampleCount: number;
  onToggle: (tagId: number, next: boolean) => void;
  onClose: () => void;
}

export function TagPickerDialog({ tags, checkedIds, sampleCount, onToggle, onClose }: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return flattenTags(tags).filter(
      ({ node }) => !needle || node.path.toLowerCase().includes(needle),
    );
  }, [tags, filter]);

  return (
    <Dialog width={452} label={t("tagsDialog.title")} onClose={onClose}>
      <h2 className="dialog-title">{t("tagsDialog.title")}</h2>
      <p className="dialog-body dialog-body-spaced">
        {t("tagsDialog.body", { count: sampleCount })}
      </p>
      <input
        className="input"
        value={filter}
        placeholder={t("tagsDialog.filterPlaceholder")}
        onChange={(e) => {
          setFilter(e.target.value);
        }}
      />
      <div className="tag-picker-list">
        {rows.map(({ node, depth }) => (
          <div key={node.id} style={{ paddingLeft: depth * 14 }}>
            <Checkbox
              checked={checkedIds.has(node.id)}
              onChange={(next) => {
                onToggle(node.id, next);
              }}
            >
              <span
                className="tree-dot"
                style={{ background: tagPalette(node.path, node.color).dot }}
              />
              <span className="mono">{node.path}</span>
            </Checkbox>
          </div>
        ))}
      </div>
      <div className="dialog-actions">
        <DialogDismissButton className="btn btn-secondary">{tc("action.close")}</DialogDismissButton>
      </div>
    </Dialog>
  );
}
