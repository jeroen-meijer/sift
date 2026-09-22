/** Every Tauri command Sift calls, with the shapes the Rust side sends back. */
import { invoke } from "@tauri-apps/api/core";
import type { ColumnWidths, ResizableColumn } from "./columnWidths";
import { DEFAULT_COLUMN_WIDTHS } from "./columnWidths";
import { DEFAULT_COLUMN_ORDER } from "./columnOrder";
import { profiled } from "./profile";

export type { ColumnWidths } from "./columnWidths";
export type { ResizableColumn } from "./columnWidths";

export interface TagChip {
  id: number;
  path: string;
  color: string | null;
}

export interface SampleRow {
  id: number;
  root_id: number;
  path: string;
  filename: string;
  parent_path: string;
  extension: string;
  size_bytes: number | null;
  missing: boolean;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  duration_ms: number | null;
  format: string | null;
  bpm: number | null;
  key_name: string | null;
  sample_type: string | null;
  favorite: boolean;
  tags: TagChip[];
}

export interface FolderNode {
  path: string;
  name: string;
  root_id: number;
  depth: number;
  is_root: boolean;
  favorite: boolean;
  sample_count: number;
}

export interface TagNode {
  id: number;
  path: string;
  name: string;
  parent_id: number | null;
  color: string | null;
  sample_count: number;
  children: TagNode[];
}

export interface DbStats {
  roots: number;
  samples: number;
  missing: number;
  tags: number;
  data_dir: string;
  clips_dir: string;
  clips_bytes: number;
}

export interface PeakData {
  channels: number;
  sample_rate: number;
  duration_ms: number;
  bucket_count: number;
  peaks: number[];
  /** Flat RGB triples (`bucket_count * 3`): bass→R, mid→G, treble→B. */
  colors: number[];
}

export interface PlaybackState {
  position_secs: number;
  playing: boolean;
}

export interface OutputDevice {
  id: string;
  name: string;
  is_default: boolean;
}

export type SortColumn = "name" | "type" | "bpm" | "key" | "created_at" | "favorite";
export type SortDirection = "asc" | "desc";

export interface SampleQuery {
  folder_prefix: string | null;
  text: string | null;
  tag_path: string | null;
  tag_paths: string[];
  bpm_min: number | null;
  bpm_max: number | null;
  key: string | null;
  half_double: boolean;
  relative_key: boolean;
  favorites_only: boolean;
  sort_column: SortColumn;
  sort_direction: SortDirection;
  limit: number;
  offset: number;
}

export interface CustomAnalysisOpts {
  overwrite_tags: boolean;
  rerun_bpm: boolean;
  rerun_key: boolean;
  rerun_type: boolean;
}

/* ── events ──────────────────────────────────────────────────────────── */

export interface IndexProgress {
  root_id: number;
  scanned: number;
  indexed: number;
  skipped: number;
  current_path: string;
  done: boolean;
}

export interface AnalysisProgress {
  sample_id: number;
  done: number;
  remaining: number;
}

/* ── settings ────────────────────────────────────────────────────────── */

export type SnapMode = "None" | "1/4" | "1/8" | "1/16";
export type WaveformView = "stereo" | "mono";
export type NewFileMode = "auto" | "ask";

/** The settings row, as stored. Every key is seeded by the Rust side. */
export interface AppSettings {
  play_on_select: boolean;
  loop_preview: boolean;
  row_waveforms: boolean;
  /** Per-bucket bass/mid/treble coloring on waveforms (default on). */
  colored_waveforms: boolean;
  snap: SnapMode;
  waveform_view: WaveformView;
  output_device: string;
  preview_gain_db: number;
  bpm_range_min: number;
  bpm_range_max: number;
  bpm_round_whole: boolean;
  new_file_mode: NewFileMode;
  notify_auto_index: boolean;
  ignore_list: string[];
  sort_column: SortColumn;
  sort_direction: SortDirection;
  half_double_bpm: boolean;
  relative_key: boolean;
  hold_hover_hotkey: string | null;
  clips_dir: string;
  column_widths: ColumnWidths;
  /** Left→right order of content columns (fav stays pinned). */
  column_order: ResizableColumn[];
  /** Color palette id (`nocturne` | `ink` | `graphite` | `snow`). */
  theme: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  play_on_select: true,
  loop_preview: true,
  row_waveforms: true,
  colored_waveforms: true,
  snap: "1/4",
  waveform_view: "stereo",
  output_device: "default",
  preview_gain_db: -6,
  bpm_range_min: 70,
  bpm_range_max: 180,
  bpm_round_whole: true,
  new_file_mode: "auto",
  notify_auto_index: false,
  ignore_list: [],
  sort_column: "name",
  sort_direction: "asc",
  half_double_bpm: false,
  relative_key: false,
  hold_hover_hotkey: null,
  clips_dir: "",
  column_widths: { ...DEFAULT_COLUMN_WIDTHS },
  column_order: [...DEFAULT_COLUMN_ORDER],
  theme: "nocturne",
};

/** Commands that return unit on the Rust side. */
async function run(command: string, args?: Record<string, unknown>): Promise<void> {
  await invoke(command, args);
}

export const ipc = {
  getSettings: () => invoke<Partial<AppSettings>>("get_settings"),
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    run("set_setting", { key, value }),

  dbStats: () => invoke<DbStats>("db_stats"),
  folderTree: (maxDepth = 6) => invoke<FolderNode[]>("folder_tree", { maxDepth }),
  addRoot: (path: string) => invoke<unknown>("add_root", { path }),
  removeRoot: (rootId: number) => run("remove_root", { rootId }),

  listSamples: (query: SampleQuery) =>
    profiled("fe.list_samples", `limit=${String(query.limit)}`, () =>
      invoke<SampleRow[]>("list_samples", { query }),
    ),
  setFavorite: (id: number, favorite: boolean) =>
    run("set_sample_favorite", { id, favorite }),
  setBpm: (id: number, bpm: number | null) => run("set_sample_bpm", { id, bpm }),
  setKey: (id: number, key: string | null) => run("set_sample_key", { id, key }),
  setType: (id: number, sampleType: string | null) =>
    run("set_sample_type", { id, sampleType }),
  removeSample: (id: number) => run("remove_sample", { id }),
  purgeMissing: () => invoke<number>("purge_missing"),
  respondAskIndex: (paths: string[], index: boolean) =>
    invoke<number>("respond_ask_index", { paths, index }),
  undo: () => invoke<boolean>("undo_meta"),
  redo: () => invoke<boolean>("redo_meta"),

  getPeaks: (sampleId: number) =>
    profiled("fe.get_peaks", `id=${String(sampleId)}`, () =>
      invoke<PeakData>("get_peaks", { sampleId }),
    ),
  play: (
    sampleId: number,
    startSecs: number | null,
    region?: { start: number; end: number } | null,
  ) =>
    profiled("fe.play_sample", `id=${String(sampleId)}`, () =>
      run("play_sample", {
        sampleId,
        startSecs,
        regionStartSecs: region?.start ?? null,
        regionEndSecs: region?.end ?? null,
      }),
    ),
  /** Retune the loop window of a running preview without restarting it. */
  setPlayRegion: (region: { start: number; end: number } | null) =>
    run("set_play_region", { startSecs: region?.start ?? null, endSecs: region?.end ?? null }),
  pause: () => run("pause_playback"),
  resume: () => run("resume_playback"),
  stop: () => run("stop_playback"),
  playbackState: () => invoke<PlaybackState>("playback_state"),
  listOutputDevices: () => invoke<OutputDevice[]>("list_output_devices"),
  setOutputDevice: (id: string) => run("set_output_device", { id }),
  setPreviewGain: (db: number) => run("set_preview_gain", { db }),
  setLoopPreview: (on: boolean) => run("set_loop_preview", { on }),
  snapZeroCrossings: (sampleId: number, points: number[]) =>
    invoke<number[]>("snap_zero_crossings", { sampleId, points }),

  listTags: () => invoke<TagNode[]>("list_tags"),
  createTag: (path: string, color: string | null) => invoke<TagNode>("create_tag", { path, color }),
  renameTag: (id: number, name: string) => run("rename_tag", { id, name }),
  moveTag: (id: number, newParentId: number | null) =>
    run("move_tag", { id, newParentId }),
  setTagColor: (id: number, color: string | null) => run("set_tag_color", { id, color }),
  deleteTag: (id: number, cascade: boolean) => run("delete_tag", { id, cascade }),
  setSampleTags: (sampleId: number, tagIds: number[]) =>
    run("set_sample_tags", { sampleId, tagIds }),
  addSampleTag: (sampleId: number, tagId: number) =>
    run("add_sample_tag", { sampleId, tagId }),
  removeSampleTag: (sampleId: number, tagId: number) =>
    run("remove_sample_tag", { sampleId, tagId }),

  analyze: (ids: number[], custom: CustomAnalysisOpts | null) =>
    invoke<number>("analyze_samples", { ids, custom }),
  renderClip: (sampleId: number, startSecs: number, endSecs: number) =>
    invoke<string>("render_jit_clip", { sampleId, startSecs, endSecs }),
  clearJitCache: () => run("clear_jit_cache"),
  setClipsDir: (path: string) => run("set_clips_dir", { path }),
  startDrag: (paths: string[]) => run("start_drag_files", { paths }),
};

/** Flatten a tag tree into rows carrying their indent depth. */
export function flattenTags(nodes: TagNode[], depth = 0): { node: TagNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenTags(node.children, depth + 1)]);
}
