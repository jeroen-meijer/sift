import { useEffect, useState } from "react";

/** Re-render when `data-theme` on `<html>` changes (canvas reads CSS vars). */
export function useThemeId(): string {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme ?? "nocturne",
  );
  useEffect(() => {
    const sync = () => {
      setTheme(document.documentElement.dataset.theme ?? "nocturne");
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return theme;
}
