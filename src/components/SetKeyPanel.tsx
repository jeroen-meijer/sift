import { CheckIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keys, matchesBinding } from "../lib/bindings";
import {
  filterMusicalKeys,
  keyMatchesStored,
  resolveKeyInput,
  type MusicalKey,
} from "../lib/keys";
import type { SampleRow } from "../lib/ipc";

export const KEY_PANEL_WIDTH = 200;

interface Props {
  focused: SampleRow;
  onSetKey: (key: string | null) => void;
}

/**
 * Searchable key flyout. The field filters the list and keeps the top hit
 * highlighted; Enter commits that hit (or a free-form value if nothing matches).
 */
export function SetKeyPanel({ focused, onSetKey }: Props) {
  const { t } = useTranslation("library");
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const hits = useMemo(() => filterMusicalKeys(query), [query]);
  const active = hits[0] ?? null;

  const commit = (key: MusicalKey | null) => {
    if (key) {
      onSetKey(key.value);
      return;
    }
    onSetKey(resolveKeyInput(query));
  };

  return (
    <div className="key-panel">
      <div className="key-panel-search">
        <input
          ref={inputRef}
          className="input input-mono key-panel-input"
          value={query}
          placeholder={t("keyFilterPlaceholder")}
          aria-label={t("keyFilterPlaceholder")}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (matchesBinding(e, keys.confirm)) {
              e.preventDefault();
              commit(active);
            }
          }}
        />
      </div>
      <div className="key-panel-list" role="listbox" aria-label={t("setKeyTitle")}>
        {hits.length === 0 ? (
          <div className="key-panel-empty">{t("keyNoMatches")}</div>
        ) : (
          hits.map((key) => {
            const selected = active?.value === key.value;
            const current = keyMatchesStored(focused.key_name, key);
            return (
              <button
                key={key.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`menu-item key-panel-row${selected ? " active" : ""}${current ? " current" : ""}`}
                onClick={() => {
                  onSetKey(key.value);
                }}
              >
                <span className="menu-label">{key.label}</span>
                {current ? <CheckIcon size={12} weight="bold" className="key-panel-tick" /> : null}
              </button>
            );
          })
        )}
      </div>
      <div className="menu-rule" role="separator" />
      <button
        type="button"
        className="menu-item key-panel-clear danger"
        onClick={() => {
          onSetKey(null);
        }}
      >
        <span className="menu-icon">
          <TrashIcon size={14} />
        </span>
        <span className="menu-label">{t("keyClear")}</span>
      </button>
    </div>
  );
}
