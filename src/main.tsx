import React from "react";
import ReactDOM from "react-dom/client";
import { defineCustomElements } from "jeep-sqlite/loader";
import App from "./App";
import { StoreProvider, initialState, hydrateState, resolveDefaultView, type AppState } from "./state/store";
import * as songsRepo from "./data/songsRepo";
import * as setlistsRepo from "./data/setlistsRepo";
import * as settingsRepo from "./data/settingsRepo";
import { EMPTY_SNAPSHOT, type PersistedSnapshot } from "./data/persistPlan";
import { NavigatorProvider } from "./navigation/Navigator";
import { preloadStageSong } from "./data/attachmentData";
import "./theme.css";

defineCustomElements(window);

interface LoadResult {
  state: AppState;
  /** False when the read itself failed (DB open/migration error, corrupt storage, etc.) rather
   * than cleanly returning empty/partial results. We can't tell a failure like that apart from
   * "real data is on disk but unreadable right now," so the app runs in-memory only for this
   * session instead of letting the debounced persist effect in store.ts silently overwrite
   * whatever's actually on disk with fresh seed data. */
  persistEnabled: boolean;
  /** What's on disk, which the first save diffs against (see store.ts). */
  persisted: PersistedSnapshot;
}

async function loadInitial(): Promise<LoadResult> {
  try {
    const [settings, songs, setlists] = await Promise.all([
      settingsRepo.loadAll(),
      songsRepo.loadAll(),
      setlistsRepo.loadAll(),
    ]);
    if (settings) {
      return { state: hydrateState(songs, setlists, settings), persistEnabled: true, persisted: { songs, setlists, settings } };
    }
    // A missing settings row isn't on its own proof this is a fresh install: songs, setlists,
    // and settings now persist in one atomic transaction (see store.ts), but an install from
    // before that change could still have leftover songs/setlists with no settings row.
    // Reseeding over that data would silently destroy it. Only treat this as first-run when
    // songs and setlists are ALSO empty; otherwise carry the recovered data forward with default
    // settings (marked as already seeded) so the next persist pass writes the missing row.
    if (songs.length > 0 || setlists.length > 0) {
      return {
        state: hydrateState(songs, setlists, { ...initialState().settings, hasSeeded: true }),
        persistEnabled: true,
        // No settings row yet, so the first save writes one.
        persisted: { songs, setlists, settings: null },
      };
    }
    return { state: initialState(), persistEnabled: true, persisted: EMPTY_SNAPSHOT };
  } catch (err) {
    console.warn(
      "Zamar: persisted storage unavailable, continuing with in-memory state only for this session " +
        "(not persisting, so as not to overwrite any real data that may still be on disk)",
      err
    );
    return { state: initialState(), persistEnabled: false, persisted: EMPTY_SNAPSHOT };
  }
}

loadInitial().then(({ state: initial, persistEnabled, persisted }) => {
  const stageSong = initial.songs.find((s) => s.id === initial.stage.songId);
  preloadStageSong(stageSong, resolveDefaultView(stageSong));
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <StoreProvider initial={initial} persisted={persisted} persistEnabled={persistEnabled}>
        <NavigatorProvider>
          <App />
        </NavigatorProvider>
      </StoreProvider>
    </React.StrictMode>
  );
});
