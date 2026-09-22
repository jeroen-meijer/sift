import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./components/AppShell";
import { applyTheme } from "./theme";
import "./themes/dark-default.css";

applyTheme("dark-default");

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

createRoot(root).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
