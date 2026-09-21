export const THEMES = ["dark-default"] as const;
export type ThemeId = (typeof THEMES)[number];

export function applyTheme(theme: ThemeId = "dark-default") {
  document.documentElement.dataset.theme = theme;
}
