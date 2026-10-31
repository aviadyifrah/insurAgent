import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initFirebase } from "./firebase";
import { App } from "./App";
import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/700.css";
import "@fontsource/heebo/800.css";
import "./styles.css";

await initFirebase();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
