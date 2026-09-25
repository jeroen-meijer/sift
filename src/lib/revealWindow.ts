import { getCurrentWindow } from "@tauri-apps/api/window";
import { bootMark, profileMark } from "./profile";

let revealed = false;

/**
 * Show the main window once. It starts with `visible: false` so the webview
 * can paint before the window appears. Safe to call again.
 * Plain Vite has no Tauri window; failures there are ignored.
 */
export async function revealMainWindow(): Promise<void> {
  if (revealed) return;
  try {
    const window = getCurrentWindow();
    const t0 = performance.now();
    await window.show();
    revealed = true;
    profileMark("boot.fe.show_ipc", performance.now() - t0, "");
    bootMark("fe.window_show_done");
    await window.setFocus().catch(() => undefined);
  } catch {
    /* Leave revealed false so a later retry can run outside Tauri. */
  }
}
