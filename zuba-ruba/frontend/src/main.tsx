import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setupWebApp } from "./telegram";
import "./styles.css";
import "./app.css";

setupWebApp();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
