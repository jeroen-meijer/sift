import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Align the popover to the right edge of the field (type editor). */
  align?: "right";
}

/** Absolute wrapper for an open omni filter editor. Stops clicks bubbling to the field. */
export function OmniEditorAnchor({ children, align }: Props) {
  return (
    <div
      className={align === "right" ? "omni-editor-anchor right" : "omni-editor-anchor"}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
