import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initFirebase } from "./firebase";
import { App } from "./App";
import "./styles.css";

await initFirebase();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
