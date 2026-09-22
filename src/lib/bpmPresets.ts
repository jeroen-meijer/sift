/** The BPM analysis ranges the design offers in Settings and Custom analysis. */
export interface BpmPreset {
  min: number;
  max: number;
  labelKey: string;
  isDefault?: boolean;
}

export const BPM_PRESETS: BpmPreset[] = [
  { min: 60, max: 150, labelKey: "bpmPreset_60_150" },
  { min: 68, max: 135, labelKey: "bpmPreset_68_135" },
  { min: 70, max: 180, labelKey: "bpmPreset_70_180", isDefault: true },
  { min: 90, max: 180, labelKey: "bpmPreset_90_180" },
  { min: 98, max: 195, labelKey: "bpmPreset_98_195" },
];

export const BPM_FLOOR = 40;
export const BPM_CEILING = 240;
