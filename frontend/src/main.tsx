import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ensureStudionet } from "./lib/client";

// Silently attempt to add / switch to Studionet on page load.
// The user will see a MetaMask prompt only if their wallet needs to switch chains.
ensureStudionet().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
