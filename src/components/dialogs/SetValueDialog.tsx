import { useState } from "react";
import { useTranslation } from "react-i18next";
import { keys, matchesBinding } from "../../lib/bindings";
import { Dialog } from "../../ui/Dialog";

interface Props {
  title: string;
  body: string;
  initial: string;
  placeholder?: string;
  onCancel: () => void;
  onApply: (value: string) => void;
}

/** Shared by Set BPM… and Set key…: one field, empty clears the value. */
export function SetValueDialog({
  title,
  body,
  initial,
  placeholder,
  onCancel,
  onApply,
}: Props) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");
  const [value, setValue] = useState(initial);

  return (
    <Dialog width={400} label={title} onClose={onCancel}>
      <h2 className="dialog-title">{title}</h2>
      <p className="dialog-body dialog-body-spaced">{body}</p>
      <input
        className="input input-mono"
        value={value}
        placeholder={placeholder}
        autoFocus
        onChange={(e) => {
          setValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (matchesBinding(e, keys.confirm)) onApply(value);
        }}
      />
      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {tc("cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            onApply(value);
          }}
        >
          {t("apply")}
        </button>
      </div>
    </Dialog>
  );
}
