import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  PlugChargingIcon,
  PlusIcon,
  StarIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { flattenTags, type SampleRow, type SnapMode, type TagNode } from "../lib/ipc";
import type { PeakData, WaveformView as WaveformMode } from "../lib/ipc";
import { tagPalette } from "../lib/tagColors";
import { Popover } from "../ui/Popover";
import { TransportBar } from "./TransportBar";
import { WaveformView, type Selection } from "./WaveformView";

interface Props {
  sample: SampleRow | null;
  peaks: PeakData | null;
  allTags: TagNode[];
  snap: SnapMode;
  waveformMode: WaveformMode;
  playheadSecs: number | null;
  selection: Selection | null;
  loopPreview: boolean;
  gainDb: number;
  /** A clip file for the current selection has been written and can be dragged. */
  clipReady: boolean;
  onToggleFavorite: () => void;
  onAddTag: (tagId: number) => void;
  onRemoveTag: (tagId: number) => void;
  onSeek: (secs: number) => void;
  onSelect: (selection: Selection | null) => void;
  onDragClip: () => void;
  onSnapChange: (snap: SnapMode) => void;
  onLoopChange: (on: boolean) => void;
  onGainChange: (db: number) => void;
  onRecheckPath: () => void;
  onLocate: () => void;
  onRemoveMissing: () => void;
}

export function DetailPane({
  sample,
  peaks,
  allTags,
  snap,
  waveformMode,
  playheadSecs,
  selection,
  loopPreview,
  gainDb,
  clipReady,
  onToggleFavorite,
  onAddTag,
  onRemoveTag,
  onSeek,
  onSelect,
  onDragClip,
  onSnapChange,
  onLoopChange,
  onGainChange,
  onRecheckPath,
  onLocate,
  onRemoveMissing,
}: Props) {
  const { t } = useTranslation("library");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);

  const available = useMemo(() => {
    if (!sample) return [];
    const onSample = new Set(sample.tags.map((tag) => tag.id));
    return flattenTags(allTags)
      .map(({ node }) => node)
      .filter((node) => !onSample.has(node.id));
  }, [allTags, sample]);

  if (!sample) {
    return (
      <div className="detail-pane">
        <div className="detail-placeholder">{t("selectSample")}</div>
      </div>
    );
  }

  const volume = sample.path.split("/").slice(0, 3).join("/");

  return (
    <div className="detail-pane">
      <div className="detail-header">
        <button
          type="button"
          className={`detail-fav${sample.favorite ? " on" : ""}`}
          aria-label={t("addTag")}
          aria-pressed={sample.favorite}
          onClick={onToggleFavorite}
        >
          <StarIcon size={14} weight={sample.favorite ? "fill" : "regular"} />
        </button>

        <div className="detail-identity">
          <div className="detail-name-row">
            <span className="detail-name">{sample.filename}</span>
            {sample.missing ? <span className="detail-badge">{t("fileMissing")}</span> : null}
          </div>
          <div className="detail-path">{sample.path}</div>
        </div>

        <div className="detail-meta">
          {sample.tags.map((tag) => {
            const palette = tagPalette(tag.path, tag.color);
            return (
              <span
                key={tag.id}
                className="tag-chip tag-chip-removable"
                style={{ background: palette.bg, color: palette.fg }}
              >
                {tag.path}
                <button
                  type="button"
                  className="tag-chip-x"
                  aria-label={t("removeTag")}
                  onClick={() => {
                    onRemoveTag(tag.id);
                  }}
                >
                  <XIcon size={9} />
                </button>
              </span>
            );
          })}

          <div className="detail-tag-add">
            <button
              type="button"
              className="tag-add-btn"
              title={t("addTag")}
              aria-label={t("addTag")}
              aria-expanded={tagPickerOpen}
              onClick={() => {
                setTagPickerOpen((open) => !open);
              }}
            >
              <PlusIcon size={11} />
            </button>
            {tagPickerOpen ? (
              <Popover
                label={t("addTag")}
                onClose={() => {
                  setTagPickerOpen(false);
                }}
              >
                {available.length === 0 ? (
                  <div className="popover-label">{t("noMoreTags")}</div>
                ) : (
                  available.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        onAddTag(node.id);
                        setTagPickerOpen(false);
                      }}
                    >
                      <span
                        className="tree-dot"
                        style={{ background: tagPalette(node.path, node.color).dot }}
                      />
                      {node.path}
                    </button>
                  ))
                )}
              </Popover>
            ) : null}
          </div>

          <div className="detail-divider" />
          <div className="detail-pills">
            <span className="meta-pill">{sample.sample_type ?? "—"}</span>
            <span className="meta-pill">
              {sample.bpm == null ? "BPM —" : `${Math.round(sample.bpm)} BPM`}
            </span>
            <span className="meta-pill">{sample.key_name ?? "Key —"}</span>
          </div>
        </div>
      </div>

      {sample.missing ? (
        <div className="detail-missing">
          <PlugChargingIcon size={26} />
          <div>
            <div className="detail-missing-title">{t("missingTitle")}</div>
            <p className="detail-missing-body">
              <Trans
                t={t}
                i18nKey="missingBody"
                values={{ volume }}
                components={[<span className="mono detail-missing-volume" key="volume" />]}
              />
            </p>
            <div className="detail-missing-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={onLocate}>
                <ArrowsClockwiseIcon size={13} />
                {t("locate")}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRecheckPath}>
                <ArrowCounterClockwiseIcon size={13} />
                {t("recheckPath")}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRemoveMissing}>
                {t("removeFromLibrary")}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="detail-wave">
            <WaveformView
              peaks={peaks}
              bpm={sample.bpm}
              snap={snap}
              mode={waveformMode}
              playheadSecs={playheadSecs}
              selection={selection}
              clipReady={clipReady}
              onSeek={onSeek}
              onSelect={onSelect}
              onDragClip={onDragClip}
            />
          </div>
          <TransportBar
            snap={snap}
            onSnapChange={onSnapChange}
            loopPreview={loopPreview}
            onLoopChange={onLoopChange}
            gainDb={gainDb}
            onGainChange={onGainChange}
          />
        </>
      )}
    </div>
  );
}
