import React from "react";
import ReactDOM from "react-dom/client";
import { defineCustomElements } from "jeep-sqlite/loader";
import App from "./App";
import { StoreProvider, initialState, hydrateState, type AppState } from "./state/store";
import * as songsRepo from "./data/songsRepo";
import * as setlistsRepo from "./data/setlistsRepo";
import * as settingsRepo from "./data/settingsRepo";
import { NavigatorProvider } from "./navigation/Navigator";
import "./theme.css";

defineCustomElements(window);

async function loadInitial(): Promise<AppState> {
  try {
    const settings = await settingsRepo.loadAll();
    if (!settings) return initialState();
    const [songs, setlists] = await Promise.all([songsRepo.loadAll(), setlistsRepo.loadAll()]);
    return hydrateState(songs, setlists, settings);
  } catch (err) {
    console.warn("Zamar: persisted storage unavailable, falling back to in-memory state", err);
    return initialState();
  }
}

loadInitial().then((initial) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <StoreProvider initial={initial}>
        <NavigatorProvider>
          <App />
        </NavigatorProvider>
      </StoreProvider>
    </React.StrictMode>
  );
});
