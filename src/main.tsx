import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { bootMark, warmProfile } from "./lib/profile";
import { DEFAULT_THEME, applyTheme } from "./theme";
import "./styles/tokens.css";

bootMark("fe.main_enter");
void warmProfile();

applyTheme(DEFAULT_THEME);
bootMark("fe.theme_default");

// Native WDIO e2e builds only (`VITE_E2E=1` via build:e2e:app). Keeps release bundles clean.
if (import.meta.env.VITE_E2E === "1") {
  void import("@wdio/tauri-plugin");
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
bootMark("fe.react_render_scheduled");
