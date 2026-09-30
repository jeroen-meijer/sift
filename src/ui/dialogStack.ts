/** Open-dialog depth for Escape ownership and library hotkey gating. */
let dialogStack = 0;

export function isDialogOpen(): boolean {
  return dialogStack > 0;
}

/** Current open-dialog depth (topmost Escape handler). */
export function dialogDepth(): number {
  return dialogStack;
}

export function pushDialog(): number {
  dialogStack += 1;
  return dialogStack;
}

export function popDialog(): void {
  dialogStack = Math.max(0, dialogStack - 1);
}
