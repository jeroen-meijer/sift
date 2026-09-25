import { useState } from "react";
import { useTranslation } from "react-i18next";
import { keys, matchesBinding } from "../../lib/bindings";
import { Dialog, DialogActionButton, DialogDismissButton } from "../../ui/Dialog";
import { useDialogClose } from "../../ui/dialogClose";

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
  return (
    <Dialog width={400} label={title} onClose={onCancel}>
      <SetValueBody
        title={title}
        body={body}
        initial={initial}
        onApply={onApply}
        {...(placeholder != null ? { placeholder } : {})}
      />
    </Dialog>
  );
}

function SetValueBody({
  title,
  body,
  initial,
  placeholder,
  onApply,
}: {
  title: string;
  body: string;
  initial: string;
  placeholder?: string;
  onApply: (value: string) => void;
}) {
  const { t } = useTranslation("library");
  const { t: tc } = useTranslation("common");
  const close = useDialogClose();
  const [value, setValue] = useState(initial);

  return (
    <>
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
          if (!matchesBinding(e, keys.confirm)) return;
          onApply(value);
          close();
        }}
      />
      <div className="dialog-actions">
        <DialogDismissButton className="btn btn-secondary">{tc("cancel")}</DialogDismissButton>
        <DialogActionButton
          className="btn btn-primary"
          onClick={() => {
            onApply(value);
          }}
        >
          {t("apply")}
        </DialogActionButton>
      </div>
    </>
  );
}
