import {
  ArrowsClockwiseIcon,
  CaretDoubleDownIcon,
  CaretDoubleRightIcon,
  CaretDownIcon,
  CaretRightIcon,
  FolderOpenIcon,
  LinkSimpleIcon,
  StarIcon,
  TextboxIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { isApplePlatform } from "../lib/bindings";
import type { FolderNode } from "../lib/ipc";
import { Menu, type MenuEntry } from "../ui/Menu";

export type FolderAction =
  | "reveal"
  | "copyPath"
  | "copyName"
  | "favorite"
  | "expand"
  | "collapse"
  | "expandAll"
  | "collapseAll"
  | "reindex"
  | "removeRoot";

interface Props {
  x: number;
  y: number;
  folder: FolderNode;
  hasChildren: boolean;
  expanded: boolean;
  onSelect: (action: FolderAction, folder: FolderNode) => void;
  onClose: () => void;
}

/** Context menu for a sidebar folder row. Same `Menu` shell as `SampleMenu`. */
export function FolderMenu({
  x,
  y,
  folder,
  hasChildren,
  expanded,
  onSelect,
  onClose,
}: Props) {
  const { t } = useTranslation("common");

  const entries: MenuEntry[] = [
    {
      kind: "item",
      id: "reveal",
      label: isApplePlatform() ? t("menu.reveal") : t("menu.revealWindows"),
      icon: <FolderOpenIcon size={14} />,
    },
    {
      kind: "item",
      id: "copyPath",
      label: t("menu.copyPath"),
      icon: <LinkSimpleIcon size={14} />,
    },
    {
      kind: "item",
      id: "copyName",
      label: t("menu.copyFolderName"),
      icon: <TextboxIcon size={14} />,
    },
    { kind: "rule" },
    {
      kind: "item",
      id: "favorite",
      label: folder.favorite ? t("menu.unfavoriteFolder") : t("menu.favoriteFolder"),
      icon: <StarIcon size={14} weight={folder.favorite ? "fill" : "regular"} />,
    },
  ];

  if (hasChildren) {
    entries.push({ kind: "rule" });
    if (expanded) {
      entries.push({
        kind: "item",
        id: "collapse",
        label: t("menu.collapseFolder"),
        icon: <CaretDownIcon size={14} weight="bold" />,
      });
    } else {
      entries.push({
        kind: "item",
        id: "expand",
        label: t("menu.expandFolder"),
        icon: <CaretRightIcon size={14} weight="bold" />,
      });
    }
    entries.push({
      kind: "item",
      id: "expandAll",
      label: t("menu.expandAllFolders"),
      icon: <CaretDoubleRightIcon size={14} weight="bold" />,
    });
    if (expanded) {
      entries.push({
        kind: "item",
        id: "collapseAll",
        label: t("menu.collapseAllFolders"),
        icon: <CaretDoubleDownIcon size={14} weight="bold" />,
      });
    }
  }

  if (folder.is_root) {
    entries.push(
      { kind: "rule" },
      {
        kind: "item",
        id: "reindex",
        label: t("menu.reindexRoot"),
        icon: <ArrowsClockwiseIcon size={14} />,
      },
      {
        kind: "item",
        id: "removeRoot",
        label: t("menu.removeRoot"),
        icon: <TrashIcon size={14} />,
        danger: true,
      },
    );
  }

  return (
    <Menu
      x={x}
      y={y}
      label={folder.name}
      entries={entries}
      onClose={onClose}
      onSelect={(id) => {
        onSelect(id as FolderAction, folder);
        onClose();
      }}
    />
  );
}
