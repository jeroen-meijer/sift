import { HardDrivesIcon, PlusIcon, StarIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export interface FolderNode {
  path: string;
  name: string;
  root_id: number;
  depth: number;
  is_root: boolean;
  favorite: boolean;
  sample_count: number;
}

interface Props {
  nodes: FolderNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onAddRoot: () => void;
}

export function FolderSidebar({ nodes, selectedPath, onSelect, onAddRoot }: Props) {
  const { t } = useTranslation("library");

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-label">{t("folders")}</span>
        <button
          type="button"
          className="btn-icon"
          title={t("addRoot")}
          aria-label={t("addRoot")}
          onClick={onAddRoot}
        >
          <PlusIcon size={12} />
        </button>
      </div>
      <div className="sidebar-scroll">
        {nodes.length === 0 ? (
          <div className="sidebar-empty">{t("noRoots")}</div>
        ) : (
          nodes.map((node) => {
            const selected = selectedPath === node.path;
            return (
              <button
                key={node.path}
                type="button"
                className={`folder-row${selected ? " selected" : ""}${node.is_root ? " root" : ""}`}
                style={{ paddingLeft: 8 + node.depth * 12 }}
                onClick={() => void onSelect(node.path)}
              >
                {node.is_root ? <HardDrivesIcon size={13} weight="fill" /> : null}
                <span className="folder-name">{node.name}</span>
                {node.favorite ? <StarIcon size={9} weight="fill" className="folder-fav" /> : null}
                <span className="folder-count">{node.sample_count}</span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
