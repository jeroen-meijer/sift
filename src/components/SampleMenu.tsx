import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  FolderOpenIcon,
  FunnelIcon,
  LinkSimpleIcon,
  MetronomeIcon,
  MusicNotesIcon,
  ShapesIcon,
  SlidersIcon,
  StarIcon,
  TagIcon,
  TextboxIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { keys, isApplePlatform } from "../lib/bindings";
import type { SampleRow } from "../lib/ipc";
import { Menu, type MenuEntry } from "../ui/Menu";
import { BPM_PANEL_WIDTH, SetBpmPanel } from "./SetBpmPanel";
import { KEY_PANEL_WIDTH, SetKeyPanel } from "./SetKeyPanel";

export type SampleAction =
  | "open"
  | "favorite"
  | "tags"
  | "type:loop"
  | "type:one-shot"
  | "type:none"
  | "showParent"
  | "reveal"
  | "copyPath"
  | "copyFilename"
  | "reanalyze"
  | "customAnalysis"
  | "removeMissing";

interface Props {
  x: number;
  y: number;
  sample: SampleRow;
  /** Every row the actions apply to: the selection, or just this row. */
  targets: SampleRow[];
  bpmMin: number;
  bpmMax: number;
  roundBpm: boolean;
  onRoundBpmChange: (round: boolean) => void;
  onSetBpm: (bpm: number | null) => void;
  onSetBpmFromBeats: (beats: number) => void;
  onSetKey: (key: string | null) => void;
  onSelect: (action: SampleAction, sample: SampleRow) => void;
  onClose: () => void;
  /** Open Set key / Set BPM as a standalone panel (keyboard K / B). */
  openPanel?: "key" | "bpm";
}

export function SampleMenu({
  x,
  y,
  sample,
  targets,
  bpmMin,
  bpmMax,
  roundBpm,
  onRoundBpmChange,
  onSetBpm,
  onSetBpmFromBeats,
  onSetKey,
  onSelect,
  onClose,
  openPanel,
}: Props) {
  const { t } = useTranslation("common");
  const { t: tl } = useTranslation("library");

  const entries: MenuEntry[] = [
    {
      kind: "item",
      id: "open",
      label: t("menu.open"),
      icon: <ArrowSquareOutIcon size={14} />,
      hint: keys.open.hint,
      disabled: sample.missing,
    },
    { kind: "rule" },
    {
      kind: "item",
      id: "favorite",
      label: sample.favorite ? t("menu.unfavorite") : t("menu.favorite"),
      icon: <StarIcon size={14} weight={sample.favorite ? "fill" : "regular"} />,
      hint: keys.favorite.hint,
    },
    {
      kind: "item",
      id: "tags",
      label: t("menu.addTags"),
      icon: <TagIcon size={14} />,
      hint: keys.tags.hint,
    },
    {
      kind: "submenu",
      id: "type",
      label: t("menu.setType"),
      icon: <ShapesIcon size={14} />,
      hint: keys.cycleType.hint,
      options: [
        { id: "type:loop", label: tl("table.type.loop"), checked: sample.sample_type === "loop" },
        {
          id: "type:one-shot",
          label: tl("table.type.oneShot"),
          checked: sample.sample_type === "one-shot",
        },
        { id: "type:none", label: tl("table.type.unset"), checked: sample.sample_type == null },
      ],
    },
    {
      kind: "panel",
      id: "bpm",
      label: t("menu.setBpm"),
      icon: <MetronomeIcon size={14} />,
      hint: keys.setBpm.hint,
      width: BPM_PANEL_WIDTH,
      content: (
        <SetBpmPanel
          targets={targets}
          focused={sample}
          bpmMin={bpmMin}
          bpmMax={bpmMax}
          round={roundBpm}
          onRoundChange={onRoundBpmChange}
          onSetBpm={(bpm) => {
            onSetBpm(bpm);
            onClose();
          }}
          onSetFromBeats={(beats) => {
            onSetBpmFromBeats(beats);
            onClose();
          }}
          onClear={() => {
            onSetBpm(null);
            onClose();
          }}
        />
      ),
    },
    {
      kind: "panel",
      id: "key",
      label: t("menu.setKey"),
      icon: <MusicNotesIcon size={14} />,
      hint: keys.setKey.hint,
      width: KEY_PANEL_WIDTH,
      content: (
        <SetKeyPanel
          focused={sample}
          onSetKey={(key) => {
            onSetKey(key);
            onClose();
          }}
        />
      ),
    },
    { kind: "rule" },
    {
      kind: "item",
      id: "showParent",
      label: t("menu.showParent"),
      icon: <FunnelIcon size={14} />,
    },
    { kind: "rule" },
    {
      kind: "item",
      id: "reveal",
      label: isApplePlatform() ? t("menu.reveal") : t("menu.revealWindows"),
      icon: <FolderOpenIcon size={14} />,
      hint: keys.reveal.hint,
      disabled: sample.missing,
    },
    {
      kind: "item",
      id: "copyPath",
      label: t("menu.copyPath"),
      icon: <LinkSimpleIcon size={14} />,
      hint: keys.copyPath.hint,
    },
    {
      kind: "item",
      id: "copyFilename",
      label: t("menu.copyFilename"),
      icon: <TextboxIcon size={14} />,
      hint: keys.copyFilename.hint,
    },
    { kind: "rule" },
    {
      kind: "item",
      id: "reanalyze",
      label: t("menu.reanalyze"),
      icon: <ArrowsClockwiseIcon size={14} />,
      disabled: sample.missing,
    },
    {
      kind: "item",
      id: "customAnalysis",
      label: t("menu.customAnalysis"),
      icon: <SlidersIcon size={14} />,
      disabled: sample.missing,
    },
  ];

  if (sample.missing) {
    entries.push(
      { kind: "rule" },
      {
        kind: "item",
        id: "removeMissing",
        label: t("menu.removeMissing"),
        icon: <TrashIcon size={14} />,
        danger: true,
      },
    );
  }

  return (
    <Menu
      x={x}
      y={y}
      label={sample.filename}
      entries={entries}
      {...(openPanel != null ? { initialOpen: openPanel, panelOnly: true } : {})}
      onClose={onClose}
      onSelect={(id) => {
        onSelect(id as SampleAction, sample);
      }}
    />
  );
}
