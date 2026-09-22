/** New files the watcher found, grouped the way the prompt shows them. */
export interface AskIndexGroup {
  folder: string;
  paths: string[];
}

/** Group paths by their parent folder, keeping first-seen order. */
export function groupByFolder(paths: string[]): AskIndexGroup[] {
  const byFolder = new Map<string, string[]>();
  for (const path of paths) {
    const folder = path.slice(0, Math.max(0, path.lastIndexOf("/"))) || "/";
    const bucket = byFolder.get(folder);
    if (bucket) bucket.push(path);
    else byFolder.set(folder, [path]);
  }
  return [...byFolder].map(([folder, group]) => ({ folder, paths: group }));
}
