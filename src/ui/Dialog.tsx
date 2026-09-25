import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { keys, matchesBinding } from "../lib/bindings";
import { DialogCloseContext, useDialogClose } from "./dialogClose";
import { motionMs } from "./motion";

interface Props {
  width: number;
  /**
   * Called after the exit animation. Parent should unmount here (and only
   * here). Dismiss controls and confirming actions share this path.
   */
  onClose: () => void;
  /**
   * Return `false` to keep the dialog open (clear an inner draft first).
   * Escape, backdrop, and dismiss/action buttons all go through this.
   */
  onBeforeClose?: () => boolean;
  label: string;
  /** Extra class on the card (e.g. settings shell). */
  className?: string;
  /** Skip the default card padding when the child brings its own chrome. */
  bare?: boolean;
  children: ReactNode;
}

/** Open dialog count; only the topmost dialog handles Escape. */
let dialogStack = 0;

type DialogButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">;

function DialogButton({ children, onClick, ...rest }: DialogButtonProps) {
  const close = useDialogClose();
  return (
    <button
      type="button"
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) close();
      }}
    >
      {children}
    </button>
  );
}

/** Cancel / X: dismisses with the exit animation. */
export function DialogDismissButton(props: DialogButtonProps) {
  return <DialogButton {...props} />;
}

/**
 * Primary / confirm control: runs `onClick`, then dismisses with the exit
 * animation. Parent action handlers should not unmount; `Dialog`'s `onClose`
 * does that.
 */
export function DialogActionButton(props: DialogButtonProps) {
  return <DialogButton {...props} />;
}

/**
 * Scrim + card. Escape and backdrop dismiss. Exit reverses the enter
 * animation, then `onClose` runs so the parent can unmount. Confirming
 * actions should use {@link DialogActionButton} (or {@link useDialogClose})
 * so they share that path.
 */
export function Dialog({
  width,
  onClose,
  onBeforeClose,
  label,
  className,
  bare = false,
  children,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const exitTimer = useRef(0);
  const [leaving, setLeaving] = useState(false);

  const requestClose = useCallback(() => {
    if (leaving) return;
    if (onBeforeClose != null && !onBeforeClose()) return;
    setLeaving(true);
    window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(() => {
      onClose();
    }, motionMs("--motion-base"));
  }, [leaving, onBeforeClose, onClose]);

  useEffect(() => {
    dialogStack += 1;
    const depth = dialogStack;
    const onKey = (e: KeyboardEvent) => {
      if (!matchesBinding(e, keys.dismiss)) return;
      if (depth !== dialogStack) return;
      e.preventDefault();
      e.stopPropagation();
      requestClose();
    };
    /* Bubble so a focused field can claim Escape first (stopPropagation). */
    window.addEventListener("keydown", onKey);
    cardRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      dialogStack -= 1;
    };
  }, [requestClose]);

  useEffect(
    () => () => {
      window.clearTimeout(exitTimer.current);
    },
    [],
  );

  return (
    <div
      className={`dialog-scrim${leaving ? " leaving" : ""}`}
      onPointerDown={(e) => {
        /* Eat the gesture so it cannot reach the app under the scrim. */
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      }}
    >
      <div
        ref={cardRef}
        className={`dialog-card${bare ? " bare" : ""}${leaving ? " leaving" : ""}${className ? ` ${className}` : ""}`}
        style={{ width }}
        role="dialog"
        aria-modal
        aria-label={label}
        tabIndex={-1}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <DialogCloseContext.Provider value={requestClose}>{children}</DialogCloseContext.Provider>
      </div>
    </div>
  );
}
