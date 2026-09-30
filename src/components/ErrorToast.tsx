import { WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { errorLocaleKey, formatErrorCopyPayload } from "../lib/appError";
import { dismissAppError, errorToastStore } from "../lib/errorToastStore";
import { useStoreSelector } from "../lib/store";
import { CopyableText } from "../ui/CopyableText";

const AUTO_DISMISS_MS = 8_000;

/** Single replaceable error toast pinned above the status bar. */
export function ErrorToast() {
  const { t } = useTranslation("errors");
  const { t: tc } = useTranslation("common");
  const payload = useStoreSelector(errorToastStore, (s) => s.payload);
  const seq = useStoreSelector(errorToastStore, (s) => s.seq);

  useEffect(() => {
    if (!payload) return;
    const timer = window.setTimeout(() => {
      dismissAppError();
    }, AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [payload, seq]);

  if (!payload) return null;

  const key = errorLocaleKey(payload.code);
  const localized = t(key, { defaultValue: t("generic") });
  const copyText = formatErrorCopyPayload(
    payload.code,
    localized,
    payload.detail,
    "Sift",
  );

  return (
    <div className="ask-toast error-toast" role="alert">
      <WarningCircleIcon size={17} className="ask-toast-icon" />
      <div className="ask-toast-body">
        <div className="ask-toast-title">{localized}</div>
        <CopyableText text={copyText} display={payload.code} />
      </div>
      <button
        type="button"
        className="ask-toast-close"
        aria-label={tc("action.dismiss")}
        onClick={() => {
          dismissAppError();
        }}
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}
