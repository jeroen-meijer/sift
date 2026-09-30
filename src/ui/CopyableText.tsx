import { CheckIcon, CopySimpleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  /** Full string written to the clipboard on click. */
  text: string;
  /** Truncated or relative label shown in the control. Defaults to `text`. */
  display?: string;
}

/** Click-to-copy text control (detail path, recovery backup path, …). */
export function CopyableText({ text, display }: Props) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = display ?? text;

  useEffect(() => {
    setCopied(false);
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, [text]);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const onCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        setCopied(false);
      }, 1400);
    });
  };

  return (
    <button
      type="button"
      className={`detail-path${copied ? " copied" : ""}`}
      aria-label={copied ? t("menu.copyPathDone") : t("menu.copyPath")}
      title={copied ? t("menu.copyPathDone") : text}
      onClick={onCopy}
      onMouseLeave={() => {
        if (resetTimer.current) clearTimeout(resetTimer.current);
        setCopied(false);
      }}
      onBlur={() => {
        if (resetTimer.current) clearTimeout(resetTimer.current);
        setCopied(false);
      }}
    >
      <span className="detail-path-text">
        <span className="detail-path-text-inner">{shown}</span>
      </span>
      <span className="detail-path-copy" aria-hidden>
        <span className={`detail-path-copy-icon${copied ? " is-hidden" : " is-shown"}`}>
          <CopySimpleIcon size={11} weight="bold" />
        </span>
        <span className={`detail-path-copy-icon${copied ? " is-shown" : " is-hidden"}`}>
          <CheckIcon size={11} weight="bold" />
        </span>
      </span>
    </button>
  );
}
