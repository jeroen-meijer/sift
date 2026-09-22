import {
  CaretDownIcon,
  CaretRightIcon,
  FolderIcon,
  FolderOpenIcon,
  HardDrivesIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCount } from "../lib/format";
import { flattenTags, type FolderNode, type TagNode } from "../lib/ipc";
import { tagPalette } from "../lib/tagColors";

interface Props {
  folders: FolderNode[];
  tags: TagNode[];
  selectedPath: string | null;
  selectedTagPath: string | null;
  onSelectFolder: (path: string) => void;
  onSelectTag: (path: string | null) => void;
  onAddRoot: () => void;
  onRemoveRoot: (node: FolderNode) => void;
  onManageTags: () => void;
}

export function FolderSidebar({
  folders,
  tags,
  selectedPath,
  selectedTagPath,
  onSelectFolder,
  onSelectTag,
  onAddRoot,
  onRemoveRoot,
  onManageTags,
}: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");
  const [collapsedRoots, setCollapsedRoots] = useState<Set<string>>(() => new Set());
  const [tagsOpen, setTagsOpen] = useState(true);

  const visibleFolders = useMemo(() => {
    const collapsedRootIds = new Set(
      folders.filter((n) => n.is_root && collapsedRoots.has(n.path)).map((n) => n.root_id),
    );
    return folders.filter((n) => n.is_root || !collapsedRootIds.has(n.root_id));
  }, [folders, collapsedRoots]);

  const flatTags = useMemo(() => flattenTags(tags), [tags]);

  const toggleRoot = (path: string) => {
    setCollapsedRoots((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-folders">
        <div className="sidebar-header">
          <span className="kicker">{t("folders")}</span>
          <button
            type="button"
            className="btn-icon btn-icon-sm"
            title={t("addRoot")}
            aria-label={t("addRoot")}
            onClick={onAddRoot}
          >
            <PlusIcon size={12} />
          </button>
        </div>
        <div className="sidebar-scroll">
          {folders.length === 0 ? (
            <div className="sidebar-empty">{t("noRoots")}</div>
          ) : (
            visibleFolders.map((node) => {
              const selected = selectedPath === node.path;
              const collapsed = collapsedRoots.has(node.path);
              return (
                <div
                  key={node.path}
                  className={`tree-row${node.is_root ? " root" : ""}${selected ? " selected" : ""}`}
                  onContextMenu={(e) => {
                    if (!node.is_root) return;
                    e.preventDefault();
                    onRemoveRoot(node);
                  }}
                >
                  {node.is_root ? (
                    <button
                      type="button"
                      className="tree-caret"
                      aria-label={collapsed ? t("expandRoot") : t("collapseRoot")}
                      aria-expanded={!collapsed}
                      onClick={() => {
                        toggleRoot(node.path);
                      }}
                    >
                      {collapsed ? (
                        <CaretRightIcon size={9} weight="bold" />
                      ) : (
                        <CaretDownIcon size={9} weight="bold" />
                      )}
                    </button>
                  ) : (
                    <span className="tree-pad" style={{ width: 8 + node.depth * 13 }} />
                  )}
                  <button
                    type="button"
                    className="tree-label"
                    aria-pressed={selected}
                    onClick={() => {
                      onSelectFolder(node.path);
                    }}
                  >
                    {node.is_root ? (
                      <HardDrivesIcon size={13} weight="fill" className="tree-icon root-icon" />
                    ) : selected ? (
                      <FolderOpenIcon size={13} weight="fill" className="tree-icon" />
                    ) : (
                      <FolderIcon size={13} className="tree-icon" />
                    )}
                    <span className="tree-name">{node.name}</span>
                    {node.favorite ? (
                      <StarIcon size={9} weight="fill" className="tree-fav" />
                    ) : null}
                    {node.is_root ? null : (
                      <span className="tree-count">{formatCount(node.sample_count)}</span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="sidebar-tags">
        <div className="sidebar-header">
          <button
            type="button"
            className="sidebar-tags-toggle kicker"
            aria-expanded={tagsOpen}
            onClick={() => {
              setTagsOpen((open) => !open);
            }}
          >
            {tagsOpen ? (
              <CaretDownIcon size={9} weight="bold" />
            ) : (
              <CaretRightIcon size={9} weight="bold" />
            )}
            {tc("tags")}
          </button>
          <button
            type="button"
            className="btn-icon btn-icon-sm"
            title={t("manageTags")}
            aria-label={t("manageTags")}
            onClick={onManageTags}
          >
            <SlidersHorizontalIcon size={12} />
          </button>
        </div>
        {tagsOpen ? (
          <div className="sidebar-scroll sidebar-tags-scroll">
            {flatTags.map(({ node, depth }) => {
              const selected = selectedTagPath === node.path;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`tree-row tag${selected ? " selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => {
                    onSelectTag(selected ? null : node.path);
                  }}
                >
                  <span className="tree-pad" style={{ width: 8 + depth * 12 }} />
                  <span
                    className="tree-dot"
                    style={{ background: tagPalette(node.path, node.color).dot }}
                  />
                  <span className="tree-name">{node.path}</span>
                  <span className="tree-count">{formatCount(node.sample_count)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
