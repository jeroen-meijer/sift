import { invoke } from "@tauri-apps/api/core";

let enabled: boolean | null = null;

/** True when the Rust side was started with `SIFT_PROFILE=1`. */
export async function profileEnabled(): Promise<boolean> {
  if (enabled != null) return enabled;
  try {
    enabled = await invoke<boolean>("profile_enabled");
  } catch {
    enabled = false;
  }
  return enabled;
}

/** Append a timed mark to the shared profile log (no-op when profiling is off). */
export async function profileMark(
  name: string,
  ms: number,
  detail?: string,
): Promise<void> {
  if (!(await profileEnabled())) return;
  try {
    await invoke("profile_mark", {
      name,
      ms,
      detail: detail ?? null,
    });
  } catch {
    /* ignore */
  }
}

/** Time an async FE call and log it when profiling. */
export async function profiled<T>(
  name: string,
  detail: string,
  run: () => Promise<T>,
): Promise<T> {
  const on = await profileEnabled();
  if (!on) return run();
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    await profileMark(name, performance.now() - t0, detail);
  }
}
