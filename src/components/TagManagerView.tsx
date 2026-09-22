import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { flattenTags, ipc, type TagNode } from "../lib/ipc";
import { TAG_SWATCHES, tagPalette } from "../lib/tagColors";
import { PillSelect } from "../ui/PillSelect";
import { TagDeleteDialog } from "./dialogs/TagDeleteDialog";

interface Props {
  tags: TagNode[];
  onRefresh: () => void;
  onClose: () => void;
}

function indexById(nodes: TagNode[], map = new Map<number, TagNode>()): Map<number, TagNode> {
  for (const node of nodes) {
    map.set(node.id, node);
    indexById(node.children, map);
  }
  return map;
}

function subtree(node: TagNode): TagNode[] {
  return [node, ...node.children.flatMap(subtree)];
}

export function TagManagerView({ tags, onRefresh, onClose }: Props) {
  const { t } = useTranslation("tags");
  const { t: tc } = useTranslation("common");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [draftName, setDraftName] = useState("");
  const [newPath, setNewPath] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TagNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => indexById(tags), [tags]);
  const flat = useMemo(() => flattenTags(tags), [tags]);
  const selected = selectedId == null ? null : (byId.get(selectedId) ?? null);
  const parent = selected?.parent_id != null ? byId.get(selected.parent_id) : undefined;

  useEffect(() => {
    setDraftName(selected?.name ?? "");
  }, [selected]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? flat.filter(({ node }) => node.path.toLowerCase().includes(needle)) : flat;
  }, [flat, filter]);

  const run = (action: Promise<unknown>) => {
    setError(null);
    void action
      .then(() => {
        onRefresh();
      })
      .catch((e: unknown) => {
        setError(String(e));
      });
  };

  const commitName = () => {
    const name = draftName.trim();
    if (!selected || !name || name === selected.name) return;
    run(ipc.renameTag(selected.id, name));
  };

  const createTag = () => {
    const path = (newPath ?? "").trim();
    setNewPath(null);
    if (path) run(ipc.createTag(path, null));
  };

  const palette = selected ? tagPalette(selected.path, selected.color) : null;
  const deleteTargets = confirmDelete ? subtree(confirmDelete) : [];

  return (
    <div className="full-view">
      <aside className="tag-list">
        <div className="tag-list-header">
          <span className="tag-list-title">{t("title")}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setNewPath("");
            }}
          >
            <PlusIcon size={12} />
            {t("new")}
          </button>
        </div>
        <div className="tag-list-filter">
          <input
            className="input"
            value={filter}
            placeholder={t("filterPlaceholder")}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
          />
        </div>
        {newPath != null ? (
          <div className="tag-list-filter">
            <input
              className="input input-mono"
              value={newPath}
              autoFocus
              placeholder={t("newPathPlaceholder")}
              onChange={(e) => {
                setNewPath(e.target.value);
              }}
              onBlur={createTag}
              onKeyDown={(e) => {
                if (e.key === "Enter") createTag();
                if (e.key === "Escape") setNewPath(null);
              }}
            />
          </div>
        ) : null}
        <div className="tag-list-scroll">
          {visible.map(({ node, depth }) => (
            <button
              key={node.id}
              type="button"
              className={`tag-list-row${selectedId === node.id ? " selected" : ""}`}
              onClick={() => {
                setSelectedId(node.id);
              }}
            >
              <span className="tree-pad" style={{ width: 8 + depth * 14 }} />
              <span
                className="tag-swatch"
                style={{ background: tagPalette(node.path, node.color).dot }}
              />
              <span className="mono tag-list-name">{node.path}</span>
              <span className="tree-count">{node.sample_count}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="full-view-main">
        <div className="tag-editor">
          {selected && palette ? (
            <>
              <div className="kicker">{t("editing")}</div>
              <div className="tag-editor-head">
                <span className="tag-swatch large" style={{ background: palette.dot }} />
                <span className="mono tag-editor-path">{selected.path}</span>
                <span className="tag-editor-counts">
                  {t("counts", {
                    samples: selected.sample_count,
                    count: selected.children.length,
                  })}
                </span>
              </div>

              <div className="tag-editor-fields">
                <div className="tag-editor-field">
                  <div className="field">
                    <label htmlFor="tag-name">{t("name")}</label>
                    <input
                      id="tag-name"
                      className="input input-mono"
                      value={draftName}
                      onChange={(e) => {
                        setDraftName(e.target.value);
                      }}
                      onBlur={commitName}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </div>
                  <div className="field-hint">
                    {t("nameHint", { path: selected.path }).replace(/<\/?0>/g, "")}
                  </div>
                </div>
                <div className="tag-editor-field">
                  <div className="field">
                    <label htmlFor="tag-parent">{t("parent")}</label>
                    <PillSelect
                      label={t("parent")}
                      variant="input"
                      value={String(selected.parent_id ?? "")}
                      options={[
                        { value: "", label: t("noParent") },
                        ...flat
                          .filter(({ node }) => !subtree(selected).some((n) => n.id === node.id))
                          .map(({ node }) => ({ value: String(node.id), label: node.path })),
                      ]}
                      onChange={(value) => {
                        run(ipc.moveTag(selected.id, value === "" ? null : Number(value)));
                      }}
                    />
                  </div>
                  <div className="field-hint">{t("parentHint")}</div>
                </div>
              </div>

              <div className="tag-editor-colors">
                <div className="tag-editor-colors-label">{t("color")}</div>
                <div className="tag-swatch-row">
                  {TAG_SWATCHES.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`tag-swatch-pick${selected.color === color ? " on" : ""}`}
                      style={{ background: color }}
                      aria-label={color}
                      onClick={() => {
                        run(ipc.setTagColor(selected.id, color));
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    className={`tag-swatch-inherit${selected.color == null ? " on" : ""}`}
                    onClick={() => {
                      run(ipc.setTagColor(selected.id, null));
                    }}
                  >
                    <span className="tag-swatch-ghost" style={{ background: palette.dot }} />
                    {parent ? t("inheritFrom", { parent: parent.name }) : t("inheritNone")}
                  </button>
                </div>
                <div className="tag-editor-preview">
                  <span className="tag-editor-preview-label">{t("preview")}</span>
                  {[selected, ...selected.children.slice(0, 1)].map((node) => {
                    const chip = tagPalette(node.path, node.color ?? selected.color);
                    return (
                      <span
                        key={node.id}
                        className="tag-chip"
                        style={{ background: chip.bg, color: chip.fg }}
                      >
                        {node.path}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="tag-editor-delete rule">
                <div>
                  <div className="tag-editor-delete-title">{t("deleteTitle")}</div>
                  <div className="tag-editor-delete-body">
                    {t("deleteBody", { count: selected.sample_count })}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary tag-editor-delete-btn"
                  onClick={() => {
                    setConfirmDelete(selected);
                  }}
                >
                  <TrashIcon size={13} />
                  {t("delete")}
                </button>
              </div>

              {error ? <p className="error-text">{error}</p> : null}
            </>
          ) : (
            <p className="tag-editor-empty">{t("selectHint")}</p>
          )}
        </div>

        <div className="full-view-footer">
          <span className="full-view-footer-note mono">
            {t("footer", { total: flat.length, top: tags.length })}
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tc("close")}
          </button>
        </div>

        {confirmDelete ? (
          <TagDeleteDialog
            tag={confirmDelete}
            targets={deleteTargets}
            onCancel={() => {
              setConfirmDelete(null);
            }}
            onConfirm={() => {
              const id = confirmDelete.id;
              setConfirmDelete(null);
              if (selectedId === id) setSelectedId(null);
              run(ipc.deleteTag(id, true));
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
