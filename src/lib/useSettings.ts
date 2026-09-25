import { useCallback, useEffect, useState } from "react";
import { mergeColumnWidths } from "./columnWidths";
import { mergeColumnOrder } from "./columnOrder";
import { DEFAULT_SETTINGS, ipc, type AppSettings } from "./ipc";
import { bootMark, bootProfiled } from "./profile";

export interface SettingsStore {
  settings: AppSettings;
  /** Update one key and persist it. Player-backed keys go through their own command. */
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  loaded: boolean;
}

/** Commands that own a runtime object as well as the settings row. */
const PERSIST_VIA: Partial<Record<keyof AppSettings, (value: never) => Promise<void>>> = {
  loop_preview: (on: boolean) => ipc.setLoopPreview(on),
  preview_gain_db: (db: number) => ipc.setPreviewGain(db),
  output_device: (id: string) => ipc.setOutputDevice(id),
  clips_dir: (path: string) => ipc.setClipsDir(path),
};

/**
 * Loads the settings row once, then keeps it in memory. Every setter writes
 * through to the database so a restart comes back the way the user left it.
 */
export function useSettings(): SettingsStore {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void bootProfiled("fe.get_settings", "", () => ipc.getSettings())
      .then((stored) => {
        const merged = { ...DEFAULT_SETTINGS, ...stored };
        merged.column_widths = mergeColumnWidths(stored.column_widths ?? merged.column_widths);
        merged.column_order = mergeColumnOrder(stored.column_order ?? merged.column_order);
        setSettings(merged);
        bootMark("fe.settings_loaded", `theme=${merged.theme}`);
      })
      .catch(console.error)
      .finally(() => {
        setLoaded(true);
      });
  }, []);

  const set = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    const via = PERSIST_VIA[key] as ((v: AppSettings[K]) => Promise<void>) | undefined;
    void (via ? via(value) : ipc.setSetting(key, value)).catch(console.error);
  }, []);

  return { settings, set, loaded };
}
