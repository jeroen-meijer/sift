/**
 * Renders a chord hint with even glyph sizing and space between modifiers
 * and the key (`⌘O` becomes ⌘ then O), so mono fonts do not crush the symbols.
 */

interface Token {
  text: string;
  mod: boolean;
}

function tokenize(hint: string): Token[] {
  if (hint.includes("+")) {
    const parts = hint.split("+").filter((part) => part.length > 0);
    return parts.map((part, index) => ({
      text: part,
      mod: index < parts.length - 1 || /^(Ctrl|Alt|Shift|Meta)$/i.test(part),
    }));
  }
  const match = /^([⌘⌥⇧⌃]+)(.*)$/u.exec(hint);
  if (match?.[1]) {
    const mods = Array.from(match[1], (char) => ({ text: char, mod: true }));
    const rest = match[2] ? [{ text: match[2], mod: false }] : [];
    return [...mods, ...rest];
  }
  return [{ text: hint, mod: false }];
}

export function ShortcutHint({ hint }: { hint: string }) {
  const tokens = tokenize(hint);
  return (
    <span className="menu-hint" aria-hidden>
      {tokens.map((token, index) => (
        <span
          key={`${token.text}-${String(index)}`}
          className={token.mod ? "menu-hint-mod" : "menu-hint-key"}
        >
          {token.text}
        </span>
      ))}
    </span>
  );
}
