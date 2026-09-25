import { HandGrabbingIcon, StackIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../lib/format";

interface Props {
  count: number;
  bytes: number;
}

/** The accent strip under the list while more than one row is selected. */
export function SelectionBar({ count, bytes }: Props) {
  const { t } = useTranslation("library");

  return (
    <div className="selection-bar">
      <StackIcon size={13} weight="fill" />
      <span className="selection-count">{t("selection.count", { count })}</span>
      <span className="selection-sep" aria-hidden>
        ·
      </span>
      <span className="selection-meta mono">
        {formatBytes(bytes)} · {t("selection.keys")}
      </span>
      <span className="selection-drag">
        <HandGrabbingIcon size={14} />
        {t("selection.drag", { count })}
      </span>
    </div>
  );
}
