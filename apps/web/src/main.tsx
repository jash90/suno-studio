import React from "react";
import ReactDOM from "react-dom/client";
import platform from "@platform";
// web → entry/web.tsx (Convex + konto), desktop → entry/desktop.tsx (dane lokalne);
// wybór w buildzie (alias w vite.config.ts), więc Convex nie trafia do desktopu
import Root from "@entry";
import { initMonitoring } from "./monitoring";
import "./styles/index.css";

platform.init();
initMonitoring();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
