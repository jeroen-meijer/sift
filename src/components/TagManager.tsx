import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface TagNode {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  color: string | null;
  sample_count: number;
  children: TagNode[];
}

interface Props {
  onClose: () => void;
}

function flatten(nodes: TagNode[], depth = 0): { node: TagNode; depth: number }[] {
  const out: { node: TagNode; depth: number }[] = [];
  for (const node of nodes) {
    out.push({ node, depth });
    out.push(...flatten(node.children, depth + 1));
  }
  return out;
}

function countSubtree(node: TagNode): number {
  return 1 + node.children.reduce((n, c) => n + countSubtree(c), 0);
}

function effectiveColor(node: TagNode, byId: Map<number, TagNode>): string | null {
  let current: TagNode | undefined = node;
  while (current) {
    if (current.color) return current.color;
    current = current.parent_id != null ? byId.get(current.parent_id) : undefined;
  }
  return null;
}

function indexById(nodes: TagNode[], map = new Map<number, TagNode>()): Map<number, TagNode> {
  for (const n of nodes) {
    map.set(n.id, n);
    indexById(n.children, map);
  }
  return map;
}

export function TagManager({ onClose }: Props) {
  const { t } = useTranslation("tags");
  const { t: tc } = useTranslation("common");
  const [tree, setTree] = useState<TagNode[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newPath, setNewPath] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<TagNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await invoke<TagNode[]>("list_tags");
    setTree(next);
  }, []);

  useEffect(() => {
    void refresh().catch((e: unknown) => {
      setError(String(e));
    });
  }, [refresh]);

  const flat = useMemo(() => flatten(tree), [tree]);
  const byId = useMemo(() => indexById(tree), [tree]);
  const selected = selectedId != null ? byId.get(selectedId) ?? null : null;
  const totalTags = flat.length;
  const topLevel = tree.length;

  const onAdd = async () => {
    const path = newPath.trim();
    if (!path) return;
    setError(null);
    try {
      await invoke("create_tag", { path, color: null });
      setNewPath("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const onDelete = async (cascade: boolean) => {
    if (!confirmDelete) return;
    setError(null);
    try {
      await invoke("delete_tag", { id: confirmDelete.id, cascade });
      if (selectedId === confirmDelete.id) setSelectedId(null);
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteCount = confirmDelete ? countSubtree(confirmDelete) : 0;

  return (
    <div className="overlay-panel tag-manager-overlay">
      <div className="tag-manager">
        <div className="tag-manager-body">
          <aside className="tag-manager-list">
            <div className="sidebar-label">{t("title")}</div>
            <div className="tag-manager-scroll">
              {flat.map(({ node, depth }) => {
                const color = effectiveColor(node, byId);
                const on = selectedId === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={`tag-tree-row${on ? " selected" : ""}`}
                    onClick={() => void setSelectedId(node.id)}
                  >
                    <span style={{ width: 8 + depth * 14, flex: "none" }} />
                    <span
                      className="tag-swatch"
                      style={{ background: color ?? "var(--color-text-ghost)" }}
                    />
                    <span className="tag-tree-name mono">{node.name}</span>
                    <span className="tag-tree-count">{node.sample_count}</span>
                  </button>
                );
              })}
            </div>
            <div className="tag-manager-add">
              <input
                className="input"
                value={newPath}
                placeholder={t("addPathPlaceholder")}
                onChange={(e) => void setNewPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onAdd();
                }}
              />
              <button type="button" className="btn btn-secondary" onClick={() => void onAdd()}>
                {t("addTag")}
              </button>
            </div>
          </aside>

          <main className="tag-manager-detail">
            {selected ? (
              <>
                <div className="sidebar-label">{t("editing")}</div>
                <div className="tag-detail-header">
                  <span
                    className="tag-swatch large"
                    style={{
                      background: effectiveColor(selected, byId) ?? "var(--color-text-ghost)",
                    }}
                  />
                  <span className="tag-detail-path mono">{selected.path}</span>
                  <span className="muted">
                    {selected.sample_count} samples · {selected.children.length} child
                    {selected.children.length === 1 ? "" : "ren"}
                  </span>
                </div>
                <p className="muted">{t("deleteCascadeBody")}</p>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void setConfirmDelete(selected)}
                >
                  {t("delete")}…
                </button>
              </>
            ) : (
              <p className="muted">{t("selectHint")}</p>
            )}
            {error ? <p className="error-text">{error}</p> : null}
          </main>
        </div>

        <div className="tag-manager-footer">
          <span className="muted mono">
            {totalTags} tags · {topLevel} top-level
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tc("close")}
          </button>
        </div>

        {confirmDelete ? (
          <div className="overlay-panel modal tag-delete-modal">
            <div className="overlay-card">
              <h2>{t("deleteTitle")}</h2>
              <p className="muted">{t("deleteCascadeBody")}</p>
              <p className="mono">{confirmDelete.path}</p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void setConfirmDelete(null)}
                >
                  {tc("cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void onDelete(true)}
                >
                  {t("deleteConfirm", { count: deleteCount })}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
