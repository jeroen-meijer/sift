import type { ReactNode } from "react";

interface Props {
  keysHint: string;
  syntax: string;
  children: ReactNode;
  /** Optional header row (e.g. BPM half/double). */
  header?: ReactNode;
}

/** Shared popover chrome for omni filter editors (spec §7). */
export function OmniEditorChrome({ keysHint, syntax, children, header }: Props) {
  return (
    <div className="omni-editor">
      {header ? <div className="omni-editor-header">{header}</div> : null}
      <div className="omni-editor-body">{children}</div>
      <div className="omni-editor-footer">
        <div className="omni-editor-hint">{keysHint}</div>
        <div className="omni-editor-syntax">
          Type it: <span className="mono">{syntax || "…"}</span>
        </div>
      </div>
    </div>
  );
}
