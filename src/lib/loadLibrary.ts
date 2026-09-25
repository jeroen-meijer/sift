/**
 * Load library stats, folders, and tags in stages so the window can show as
 * soon as stats are known. Order: stats, shallow folder tree (roots + packs),
 * tags, then the full folder tree.
 *
 * Cold start and structural refreshes share this path.
 */

import {
  FOLDER_TREE_FULL_DEPTH,
  FOLDER_TREE_SHALLOW_DEPTH,
  ipc,
  type DbStats,
  type FolderNode,
  type TagNode,
} from "./ipc";
import { bootMark, bootProfiled } from "./profile";

/** Setters App uses while each stage finishes. */
export interface LibrarySink {
  setStats: (stats: DbStats) => void;
  setFolders: (folders: FolderNode[]) => void;
  setTags: (tags: TagNode[]) => void;
}

/**
 * Writes each stage into `sink` as it completes. On hard failure, the caller
 * should set empty stats so boot can still leave the loading gate.
 */
export async function loadLibrary(sink: LibrarySink): Promise<void> {
  const t0 = performance.now();

  const nextStats = await bootProfiled("fe.ipc_db_stats", "", () => ipc.dbStats());
  sink.setStats(nextStats);
  bootMark(
    "fe.stats_ready",
    `roots=${String(nextStats.roots)} samples=${String(nextStats.samples)}`,
  );

  const shallow = await bootProfiled(
    "fe.ipc_folder_tree_shallow",
    `depth=${String(FOLDER_TREE_SHALLOW_DEPTH)}`,
    () => ipc.folderTree(FOLDER_TREE_SHALLOW_DEPTH),
  );
  sink.setFolders(shallow);
  bootMark("fe.tree_shallow", `folders=${String(shallow.length)}`);

  void bootProfiled("fe.ipc_list_tags", "", () => ipc.listTags())
    .then((tagTree) => {
      sink.setTags(tagTree);
    })
    .catch(console.error);

  const deep = await bootProfiled(
    "fe.ipc_folder_tree_deep",
    `depth=${String(FOLDER_TREE_FULL_DEPTH)}`,
    () => ipc.folderTree(FOLDER_TREE_FULL_DEPTH),
  );
  sink.setFolders(deep);
  bootMark(
    "fe.tree_deep",
    `folders=${String(deep.length)} span_ms=${(performance.now() - t0).toFixed(1)}`,
  );
}
