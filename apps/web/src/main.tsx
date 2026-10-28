import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./lib/theme";
import "./styles/index.css";

// Apply the stored / OS theme to <html data-theme> before the first paint.
initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
