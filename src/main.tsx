import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { bootMark, warmProfile } from "./lib/profile";
import { applyTheme } from "./theme";
import "./styles/tokens.css";

bootMark("fe.main_enter");
void warmProfile();

applyTheme("nocturne");
bootMark("fe.theme_default");

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
