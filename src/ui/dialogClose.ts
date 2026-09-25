import { createContext, useContext } from "react";

/** Set by {@link Dialog}; consumers call {@link useDialogClose}. */
export const DialogCloseContext = createContext<(() => void) | null>(null);

/**
 * Dismiss the nearest Dialog: play the exit animation, then call its
 * `onClose`. Prefer {@link DialogDismissButton} / {@link DialogActionButton}
 * when a plain button is enough.
 */
export function useDialogClose(): () => void {
  const close = useContext(DialogCloseContext);
  if (close == null) {
    throw new Error("useDialogClose must be used inside Dialog");
  }
  return close;
}
