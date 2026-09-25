import { getCurrentWindow } from "@tauri-apps/api/window";
import { bootMark, profileMark } from "./profile";

let revealed = false;

/**
 * Show the main window once (starts with `visible: false` to avoid the
 * platform white flash before the webview paints). Safe to call repeatedly.
 * Outside Tauri (plain Vite) the call fails and is ignored.
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
    /* Plain Vite has no Tauri window; leave revealed false so a later retry can run. */
  }
}
