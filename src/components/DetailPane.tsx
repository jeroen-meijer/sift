import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
  CopySimpleIcon,
  PlugChargingIcon,
  PlusIcon,
  StarIcon,
  XIcon,
} from "@phosphor-icons/react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { flattenTags, type SampleRow, type SnapMode, type TagNode } from "../lib/ipc";
import type { PeakData, WaveformView as WaveformMode } from "../lib/ipc";
import { folderChipLabel } from "../lib/omni";
import { tagPalette } from "../lib/tagColors";
import { Popover } from "../ui/Popover";
import { TransportBar } from "./TransportBar";
import { WaveformView, type Selection } from "./WaveformView";
import { useRenderTiming } from "../lib/profile";

interface Props {
  sample: SampleRow | null;
  peaks: PeakData | null;
  allTags: TagNode[];
  /** Library roots: used to show `rootName/…` instead of the absolute path. */
  roots: readonly { path: string; name: string }[];
  snap: SnapMode;
  waveformMode: WaveformMode;
  coloredWaveforms: boolean;
  /** True while this sample plays. */
  playheadActive: boolean;
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
  snapPointer: (secs: number) => number;
  onDragClip: () => void;
  onSnapChange: (snap: SnapMode) => void;
  onLoopChange: (on: boolean) => void;
  onGainChange: (db: number) => void;
  onRecheckPath: () => void;
  onLocate: () => void;
  onRemoveMissing: () => void;
}

/** Truncated filename; when clipped, hover shows the full name in a dark chip. */
function DetailName({ name }: { name: string }) {
  const clipRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    const measure = () => {
      setTruncated(el.scrollWidth > el.clientWidth + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [name]);

  return (
    <span className={`detail-name${truncated ? " is-truncated" : ""}`}>
      <span className="detail-name-clip" ref={clipRef}>
        {name}
      </span>
      {truncated ? (
        <span className="detail-name-flyout" role="tooltip">
          {name}
        </span>
      ) : null}
    </span>
  );
}

/** Root-relative path with start truncation and a hover-to-copy control. */
function DetailPath({ absolutePath, displayPath }: { absolutePath: string; displayPath: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCopied(false);
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, [absolutePath]);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const onCopy = () => {
    void navigator.clipboard.writeText(absolutePath).then(() => {
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        setCopied(false);
      }, 1400);
    });
  };

  return (
    <button
      type="button"
      className={`detail-path${copied ? " copied" : ""}`}
      aria-label={copied ? t("ctxCopyPathDone") : t("ctxCopyPath")}
      title={copied ? t("ctxCopyPathDone") : absolutePath}
      onClick={onCopy}
      onMouseLeave={() => {
        if (resetTimer.current) clearTimeout(resetTimer.current);
        setCopied(false);
      }}
      onBlur={() => {
        if (resetTimer.current) clearTimeout(resetTimer.current);
        setCopied(false);
      }}
    >
      <span className="detail-path-text">
        <span className="detail-path-text-inner">{displayPath}</span>
      </span>
      <span className="detail-path-copy" aria-hidden>
        <span className={`detail-path-copy-icon${copied ? " is-hidden" : " is-shown"}`}>
          <CopySimpleIcon size={11} weight="bold" />
        </span>
        <span className={`detail-path-copy-icon${copied ? " is-shown" : " is-hidden"}`}>
          <CheckIcon size={11} weight="bold" />
        </span>
      </span>
    </button>
  );
}

export const DetailPane = memo(function DetailPane({
  sample,
  peaks,
  allTags,
  roots,
  snap,
  waveformMode,
  coloredWaveforms,
  playheadActive,
  selection,
  loopPreview,
  gainDb,
  clipReady,
  onToggleFavorite,
  onAddTag,
  onRemoveTag,
  onSeek,
  onSelect,
  snapPointer,
  onDragClip,
  onSnapChange,
  onLoopChange,
  onGainChange,
  onRecheckPath,
  onLocate,
  onRemoveMissing,
}: Props) {
  const { t } = useTranslation("library");
  useRenderTiming("DetailPane");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState("");

  const available = useMemo(() => {
    if (!sample) return [];
    const onSample = new Set(sample.tags.map((tag) => tag.id));
    const needle = tagFilter.trim().toLowerCase();
    return flattenTags(allTags)
      .map(({ node }) => node)
      .filter((node) => !onSample.has(node.id))
      .filter((node) => !needle || node.path.toLowerCase().includes(needle));
  }, [allTags, sample, tagFilter]);

  const displayPath = useMemo(
    () => (sample ? folderChipLabel(sample.path, roots) : ""),
    [sample, roots],
  );

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
            <DetailName name={sample.filename} />
            {sample.missing ? <span className="detail-badge">{t("fileMissing")}</span> : null}
          </div>
          <DetailPath absolutePath={sample.path} displayPath={displayPath} />
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
              onPointerDown={(e) => {
                if (tagPickerOpen) e.stopPropagation();
              }}
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
                  setTagFilter("");
                }}
              >
                <input
                  className="input popover-search"
                  value={tagFilter}
                  placeholder={t("tagFilterPlaceholder")}
                  aria-label={t("tagFilterPlaceholder")}
                  autoFocus
                  onChange={(e) => {
                    setTagFilter(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                  }}
                />
                {available.length === 0 ? (
                  <div className="popover-label">
                    {tagFilter.trim() ? t("tagFilterEmpty") : t("noMoreTags")}
                  </div>
                ) : (
                  available.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        onAddTag(node.id);
                        setTagPickerOpen(false);
                        setTagFilter("");
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
              colored={coloredWaveforms}
              playheadActive={playheadActive}
              selection={selection}
              clipReady={clipReady}
              snapPointer={snapPointer}
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
});
