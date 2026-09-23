/** Split a search string into words, the same way the backend does. */
export function searchTokens(query: string): string[] {
  return query.split(/[\s_.-]+/).filter((t) => t.length > 0);
}

/**
 * Character ranges in `text` matched by any search word (case-insensitive),
 * sorted and merged so overlapping hits become one range.
 */
export function highlightRanges(text: string, query: string): [number, number][] {
  const hay = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const token of searchTokens(query.toLowerCase())) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(token, from);
      if (at < 0) break;
      ranges.push([at, at + token.length]);
      from = at + token.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
