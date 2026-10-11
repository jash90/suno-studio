import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { BrowserRouter, HashRouter } from "react-router-dom";
import platform from "@platform";
import App from "./App";
import "./App.css";

platform.init();

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// Desktop ładuje bundle z tauri://localhost — tam reload podścieżki nie trafi do
// index.html, więc ścieżki trzymamy w hashu. Web zostaje przy czystych URL-ach.
const Router = platform.kind === "desktop" ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConvexAuthProvider client={convex}>
      <Router>
        <App />
      </Router>
    </ConvexAuthProvider>
  </React.StrictMode>
);
