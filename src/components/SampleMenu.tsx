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
import type { SampleRow } from "../lib/ipc";
import { Menu, type MenuEntry } from "../ui/Menu";
import { BPM_PANEL_WIDTH, SetBpmPanel } from "./SetBpmPanel";

export type SampleAction =
  | "open"
  | "favorite"
  | "tags"
  | "type:loop"
  | "type:one-shot"
  | "type:none"
  | "key"
  | "showParent"
  | "reveal"
  | "copyPath"
  | "copyFilename"
  | "reanalyze"
  | "customAnalysis"
  | "removeMissing";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

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
  onSelect: (action: SampleAction, sample: SampleRow) => void;
  onClose: () => void;
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
  onSelect,
  onClose,
}: Props) {
  const { t } = useTranslation("common");
  const { t: tl } = useTranslation("library");
  const mod = IS_MAC ? "⌘" : "Ctrl";

  const entries: MenuEntry[] = [
    {
      kind: "item",
      id: "open",
      label: t("ctxOpen"),
      icon: <ArrowSquareOutIcon size={14} />,
      hint: `${mod}O`,
      disabled: sample.missing,
    },
    { kind: "rule" },
    {
      kind: "item",
      id: "favorite",
      label: sample.favorite ? t("ctxUnfavorite") : t("ctxFavorite"),
      icon: <StarIcon size={14} weight={sample.favorite ? "fill" : "regular"} />,
      hint: "F",
    },
    { kind: "item", id: "tags", label: t("ctxAddTags"), icon: <TagIcon size={14} />, hint: "T" },
    {
      kind: "submenu",
      id: "type",
      label: t("ctxSetType"),
      icon: <ShapesIcon size={14} />,
      options: [
        { id: "type:loop", label: tl("typeLoop"), checked: sample.sample_type === "loop" },
        {
          id: "type:one-shot",
          label: tl("typeOneShot"),
          checked: sample.sample_type === "one-shot",
        },
        { id: "type:none", label: tl("typeUnset"), checked: sample.sample_type == null },
      ],
    },
    {
      kind: "panel",
      id: "bpm",
      label: t("ctxSetBpm"),
      icon: <MetronomeIcon size={14} />,
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
    { kind: "item", id: "key", label: t("ctxSetKey"), icon: <MusicNotesIcon size={14} /> },
    { kind: "rule" },
    {
      kind: "item",
      id: "showParent",
      label: t("ctxShowParent"),
      icon: <FunnelIcon size={14} />,
    },
    { kind: "rule" },
    {
      kind: "item",
      id: "reveal",
      label: IS_MAC ? t("ctxReveal") : t("ctxRevealWindows"),
      icon: <FolderOpenIcon size={14} />,
      hint: `${mod}R`,
      disabled: sample.missing,
    },
    {
      kind: "item",
      id: "copyPath",
      label: t("ctxCopyPath"),
      icon: <LinkSimpleIcon size={14} />,
      hint: IS_MAC ? "⌥⌘C" : "Alt Ctrl C",
    },
    {
      kind: "item",
      id: "copyFilename",
      label: t("ctxCopyFilename"),
      icon: <TextboxIcon size={14} />,
      hint: `${mod}C`,
    },
    { kind: "rule" },
    {
      kind: "item",
      id: "reanalyze",
      label: t("ctxReanalyze"),
      icon: <ArrowsClockwiseIcon size={14} />,
      disabled: sample.missing,
    },
    {
      kind: "item",
      id: "customAnalysis",
      label: t("ctxCustomAnalysis"),
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
        label: t("ctxRemoveMissing"),
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
      onClose={onClose}
      onSelect={(id) => {
        onSelect(id as SampleAction, sample);
      }}
    />
  );
}
