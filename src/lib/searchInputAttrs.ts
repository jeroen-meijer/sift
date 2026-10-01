/**
 * Disable OS and browser text helpers on search fields.
 * macOS WKWebView otherwise autocorrects query text (for example Dutch "rizzle" to "rijzen").
 */
export const SEARCH_INPUT_ATTRS = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
} as const;
