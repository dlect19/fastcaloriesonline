import { StrictMode, version as reactVersion } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./lib/firebase"; // Initialize Firebase Analytics

// Development safeguard:
// If a service worker is registered, it can serve stale cached JS chunks and cause
// mixed React/runtime bundles => invalid hook call / dispatcher null errors.
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

if (import.meta.env.DEV) {
  // Helpful in console to verify we're on a single React runtime.
  console.info("[dev] React version:", reactVersion);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
