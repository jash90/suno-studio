import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { whenIdle } from "./services/download";
import App from "./App";
import "./App.css";

// Aktualizacja PWA: nowa wersja czeka, aż aplikacja będzie bezczynna (żaden
// ZIP/pobieranie nie trwa), i dopiero wtedy podmienia SW + przeładowuje kartę.
// Bez tego otwarte karty zostawały na starym bundle'u albo reload przerywał
// pobieranie w połowie.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void whenIdle().then(() => updateSW(true));
  },
});

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConvexAuthProvider client={convex}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConvexAuthProvider>
  </React.StrictMode>
);
