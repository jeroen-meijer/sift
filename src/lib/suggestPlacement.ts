/** Default suggest menu width when the viewport is wide enough. */
export const SUGGEST_MENU_WIDTH = 260;
const SUGGEST_GAP = 6;
const SUGGEST_PAD = 12;

export interface SuggestPlacement {
  left: number;
  top: number;
  width: number;
}

/**
 * Place the suggest menu under the left edge of the text input.
 * If that would spill past the viewport, move left and shrink as needed.
 */
export function suggestMenuPlacement(opts: {
  anchorLeft: number;
  anchorBottom: number;
  viewportWidth: number;
  preferredWidth?: number;
  pad?: number;
  gap?: number;
}): SuggestPlacement {
  const pad = opts.pad ?? SUGGEST_PAD;
  const gap = opts.gap ?? SUGGEST_GAP;
  const preferred = opts.preferredWidth ?? SUGGEST_MENU_WIDTH;
  const maxWidth = Math.max(0, opts.viewportWidth - pad * 2);
  const width = Math.min(preferred, maxWidth);
  let left = opts.anchorLeft;
  if (left + width > opts.viewportWidth - pad) {
    left = opts.viewportWidth - pad - width;
  }
  left = Math.max(pad, left);
  return { left, top: opts.anchorBottom + gap, width };
}
