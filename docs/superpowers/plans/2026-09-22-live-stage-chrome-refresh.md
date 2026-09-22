# Live Stage Chrome Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Live Stage's chrome per the approved spec: drop the redundant `LIVE` badge, make advancing past a setlist's last song a no-op instead of showing a "Set complete" screen, consolidate the toolbar/song-header controls into one bottom row plus a single "Stage tools" sheet, make Live Stage's base background white with Light/Stage-Dark theming scoped to chrome and the chords/lyrics view only, add real iPad Air 11″/13″ dev-preview viewports, and let a song remember a default Live Stage view (chords or a specific attachment kind) set from Add/Edit Song.

**Architecture:** All changes are additive/refactoring within the existing single-reducer (`src/state/store.ts`) + screen-component architecture — no new state-management layer, no new navigation concept. One new component (`StageToolsSheet.tsx`) replaces content that used to live split across `LiveStage.tsx`'s header/song-title row and `MusicToolbar.tsx`'s expandable second row. One new persisted `Song` field (`defaultView`) flows through the existing SQLite persistence layer (schema migration + repo mapping), the existing reducer (`ADD_SONG`/`UPDATE_SONG` already pass the whole `Song` object through untouched), and two read sites (`store.ts`'s stage-load logic, `LiveStage.tsx`'s attachment-kind-seeding effect).

**Tech Stack:** React 18 + TypeScript, Vite, `@capacitor-community/sqlite` (native) / `sql.js` + `jeep-sqlite` (browser dev), plain CSS with custom properties (`src/theme.css`). No test framework exists in this repo — `npm run build` (`tsc -b && vite build`) is the correctness bar, per `CLAUDE.md`'s documented gotcha, backed by manual click-through in `npm run dev`.

**Spec:** `docs/superpowers/specs/2026-09-21-live-stage-chrome-refresh-design.md`

## Global Constraints

- No automated test framework — every task's "verify" step is `npm run build` (must stay clean) plus a manual click-through in `npm run dev`. There is no unit-test step to write or run.
- Never add `Co-Authored-By: Claude ...` or any Claude/Anthropic attribution to commit messages (`CLAUDE.md` ground rules) and never mention Claude/Anthropic in code comments.
- Commit messages state clearly what changed and why, no `fix:`/`feat:` prefixes.
- Preserve existing comments that are still correct; only remove/rewrite ones the change actually invalidates.
- Follow this repo's heavy use of inline `style={{}}` objects for one-off component layout (as `LiveStage.tsx`/`MusicToolbar.tsx`/`AddEditSong.tsx` already do) rather than inventing new CSS classes for layout that isn't reused — reserve `theme.css` additions for genuinely shared tokens/patterns (as this plan's few additions do: two new fixed-light CSS variables, one renamed viewport selector).
- `Viewport` literal values are renamed in this plan from `"phone" | "tablet"` to `"phone" | "ipadAir11" | "ipadAir13"` — every reference across `state/types.ts`, `state/store.ts`, `App.tsx`, `components/DeviceNotch.tsx`, and `theme.css` must be updated together (Task 6) or `npm run build` will fail on the stale ones.

---

## File Structure

| File | Change |
|---|---|
| `src/state/types.ts` | Modify — new `Song.defaultView` field; remove `StageState.ended`/`toolbarExpanded`; rename `Viewport` literals |
| `src/state/store.ts` | Modify — no-op past last song, remove `ended`/`STAGE_REPLAY`/`STAGE_TOGGLE_TOOLBAR`, rename+extend `defaultView()` → `resolveDefaultView()` |
| `src/data/db.ts` | Modify — schema migration to `DB_VERSION` 5, additive `defaultView` column |
| `src/data/songsRepo.ts` | Modify — carry `defaultView` through `SongRow`/`rowToSong`/`buildInsertStatements` |
| `src/theme.css` | Modify — white light-mode `--bg`, new fixed-light `--sheet-bg`/`--sheet-fg`/`--sheet-mut` tokens, remove `.live-badge` rules (keep `--live`, still used by `Setlists.tsx`), rename `[data-viewport="tablet"]` selector |
| `src/screens/live-stage/LiveStage.tsx` | Modify — remove `LIVE` badge, remove "Set complete" screen, remove song-title-row toggle/chip rows and the dead "Parts · 2/3" trigger, add fixed-light sheet-view background, wire the new `StageToolsSheet`, consult `song.defaultView` when seeding `activeKind` |
| `src/screens/live-stage/MusicToolbar.tsx` | Modify — slims down to the one-row key-chips + tools-trigger bar |
| `src/screens/live-stage/StageToolsSheet.tsx` | **Create** — the consolidated sheet: icon row, view picker, capo/lyrics/zoom or instrument-chip row |
| `src/screens/live-stage/InstrumentFilterModal.tsx` | **Delete** — dead code, see Task 5 |
| `src/screens/add-edit-song/AddEditSong.tsx` | Modify — new "Default on Live Stage" picker |
| `src/App.tsx` | Modify — new iPad Air viewport buttons/dimensions |
| `src/components/DeviceNotch.tsx` | Modify — tablet-style notch for both new viewport values |

---

### Task 1: Persist a per-song default Live Stage view

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/data/db.ts`
- Modify: `src/data/songsRepo.ts`

**Interfaces:**
- Produces: `Song.defaultView?: "chords" | AttachmentKind` — every later task that reads or writes a `Song` sees this field.

- [ ] **Step 1: Add the field to the `Song` type**

In `src/state/types.ts`, the `Song` interface currently reads (lines 38-61):

```ts
export interface Song {
  id: string;
  title: string;
  artist: string;
  defaultKey: string;
  tempo: number;
  timeSig: string;
  durationSec: number;
  favourite: boolean;
  source: SongSource;
  chordpro: string; // raw chart, used for the chord/lyric render below — "" if this song has no chords/lyrics view
  chartFormat: ChartFormat; // which syntax the chart was authored in
  /** Zero or more categorized, versioned attachments alongside (or instead
   * of) the chords/lyrics text — a category per file kind, each holding one
   * or more versions (e.g. a Violin PDF and a Viola PDF for the same song).
   * A song can have chords, attachments, both, or neither. */
  attachments: Attachments;
  /** Freeform text notes for this song — reminders, cues, anything worth
   * having on hand regardless of chart type. "" when empty. */
  notes: string;
  /** Hand-drawn markup, one stroke layer per view type this song can show.
   * {} when nothing has been drawn yet. */
  annotations: Partial<Record<AnnotationView, Stroke[]>>;
}
```

Insert a new field right after `attachments`:

```ts
  attachments: Attachments;
  /** Which view Live Stage should open this song to — a specific attachment
   * kind, or `"chords"` for the chords/lyrics view. `undefined` means no
   * preference has been saved: Live Stage falls back to its automatic guess
   * (chords if the song has any, else its first available attachment). Set
   * from Add/Edit Song's "Default on Live Stage" picker. */
  defaultView?: "chords" | AttachmentKind;
  /** Freeform text notes for this song — reminders, cues, anything worth
   * having on hand regardless of chart type. "" when empty. */
  notes: string;
```

- [ ] **Step 2: Add the schema migration**

In `src/data/db.ts`, change:

```ts
const DB_VERSION = 4;
```

to:

```ts
const DB_VERSION = 5;
```

Then, in the `addUpgradeStatement` array (inside `openDb()`), add a new entry right after the existing `toVersion: 4` block and before the closing `]);`:

```ts
    {
      // Additive column — a song can now remember which view (chords, or a
      // specific attachment kind) Live Stage should open it to by default,
      // set from Add/Edit Song. NULL means "no preference saved," which is
      // every song that existed before this column, so no backfill of
      // existing rows is needed.
      toVersion: 5,
      statements: ["ALTER TABLE songs ADD COLUMN defaultView TEXT;"],
    },
```

- [ ] **Step 3: Carry the column through the repo layer**

In `src/data/songsRepo.ts`, the `SongRow` interface currently ends with:

```ts
interface SongRow {
  id: string;
  title: string;
  artist: string;
  defaultKey: string;
  tempo: number;
  timeSig: string;
  durationSec: number;
  favourite: number;
  source: string;
  chordpro: string;
  chartFormat: string;
  attachments_json: string;
  notes: string;
  annotations_json: string;
}
```

Add `defaultView: string | null;` right after `annotations_json: string;`:

```ts
  annotations_json: string;
  defaultView: string | null;
}
```

`rowToSong` currently ends with:

```ts
    attachments: JSON.parse(row.attachments_json || "{}") as Attachments,
    notes: row.notes ?? "",
    annotations: JSON.parse(row.annotations_json || "{}") as Song["annotations"],
  };
}
```

Add a `defaultView` line:

```ts
    attachments: JSON.parse(row.attachments_json || "{}") as Attachments,
    notes: row.notes ?? "",
    annotations: JSON.parse(row.annotations_json || "{}") as Song["annotations"],
    defaultView: (row.defaultView ?? undefined) as Song["defaultView"],
  };
}
```

`buildInsertStatements` currently reads:

```ts
export function buildInsertStatements(songs: Song[]): { statement: string; values: unknown[] }[] {
  return songs.map((s) => ({
    statement: `INSERT INTO songs
      (id, title, artist, defaultKey, tempo, timeSig, durationSec, favourite, source, chordpro, chartFormat, attachments_json, notes, annotations_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      s.id, s.title, s.artist, s.defaultKey, s.tempo, s.timeSig, s.durationSec,
      s.favourite ? 1 : 0, s.source, s.chordpro, s.chartFormat,
      JSON.stringify(s.attachments), s.notes, JSON.stringify(s.annotations),
    ],
  }));
}
```

Change to add the column and its placeholder/value:

```ts
export function buildInsertStatements(songs: Song[]): { statement: string; values: unknown[] }[] {
  return songs.map((s) => ({
    statement: `INSERT INTO songs
      (id, title, artist, defaultKey, tempo, timeSig, durationSec, favourite, source, chordpro, chartFormat, attachments_json, notes, annotations_json, defaultView)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      s.id, s.title, s.artist, s.defaultKey, s.tempo, s.timeSig, s.durationSec,
      s.favourite ? 1 : 0, s.source, s.chordpro, s.chartFormat,
      JSON.stringify(s.attachments), s.notes, JSON.stringify(s.annotations), s.defaultView ?? null,
    ],
  }));
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: clean (no TypeScript errors). No other file references `Song.defaultView` yet, so nothing else should need changes at this point.

- [ ] **Step 5: Manually verify the migration runs**

Run: `npm run dev`, open the app in a browser, open devtools console.
Expected: no SQLite init errors logged (the browser-dev fallback runs the same `addUpgradeStatement` chain against its `sql.js`-backed store). If you have a prior browser session with persisted data (IndexedDB), reloading should upgrade it to version 5 without error; a clean profile just creates the table fresh at version 5.

- [ ] **Step 6: Commit**

```bash
git add src/state/types.ts src/data/db.ts src/data/songsRepo.ts
git commit -m "Add a persisted per-song default-view field to the songs schema"
```

---

### Task 2: Remove the LIVE badge

**Files:**
- Modify: `src/screens/live-stage/LiveStage.tsx`
- Modify: `src/theme.css`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing later tasks depend on — this is a pure removal.

- [ ] **Step 1: Remove the three badge render sites**

In `src/screens/live-stage/LiveStage.tsx`, there are three places rendering `.live-badge`. (The first, inside the `stage.ended` branch, is removed in full in Task 3 — skip it here and let Task 3 delete the whole branch. Do the other two now.)

The "no song on stage" branch currently has:

```tsx
      <div className="screen">
        <div className="hdr">
          <span className="live-badge">
            <span className="dot" />
            LIVE
          </span>
        </div>
        <div className="empty">
```

Change to:

```tsx
      <div className="screen">
        <div className="hdr" />
        <div className="empty">
```

The main return's header currently has:

```tsx
      <div className={"hdr" + (setlist ? " tinted" : "")}>
        <span className={"live-badge" + (setlist ? " active" : "")} onClick={() => setlist && resetIdle()}>
          <span className="dot" />
          LIVE
        </span>
      </div>
```

Change to:

```tsx
      <div className={"hdr" + (setlist ? " tinted" : "")} />
```

- [ ] **Step 2: Remove the now-unused CSS**

In `src/theme.css`, delete this block (leave `--live: #c0392b;` on `.device` alone — it's still used by `src/screens/setlists/Setlists.tsx`'s own "live now" indicator, an unrelated feature):

```css
.live-badge {
  position: absolute;
  top: 50%;
  right: 9px;
  transform: translateY(-50%);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  padding: 5px 9px 5px 7px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--line);
  color: var(--mut);
  opacity: 0.65;
  border: none;
}
.live-badge .dot {
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: currentColor;
}
.live-badge.active {
  background: var(--live);
  color: #fff;
  opacity: 1;
}
```

- [ ] **Step 3: Verify**

Run: `npm run build` — expect clean.
Run: `npm run dev`, load Library → open a song onto Live Stage. Confirm the header band shows no badge (just a thin strip, tinted when a setlist is active). This will look slightly odd until Task 3 (no more "Set complete" badge either) and Task 5 (header becomes visually minimal by design) land — that's expected mid-plan.

- [ ] **Step 4: Commit**

```bash
git add src/screens/live-stage/LiveStage.tsx src/theme.css
git commit -m "Remove the redundant LIVE badge from Live Stage's header"
```

---

### Task 3: Make advancing past the last song a no-op

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/store.ts`
- Modify: `src/screens/live-stage/LiveStage.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `StageState` no longer has `ended`; `Action` no longer has `STAGE_REPLAY`. Later tasks (5) also remove `toolbarExpanded`/`STAGE_TOGGLE_TOOLBAR` — don't remove those here, `MusicToolbar.tsx` still reads `stage.toolbarExpanded` until Task 5 rewrites it.

- [ ] **Step 1: Stop setting `ended` in the reducer**

In `src/state/store.ts`, `STAGE_ADVANCE` currently reads:

```ts
    case "STAGE_ADVANCE": {
      const setlist = state.setlists.find((sl) => sl.id === state.stage.setlistId);
      if (!setlist) return state;
      const ids = flattenSongIds(setlist);
      const nextIndex = state.stage.setlistIndex + 1;
      if (nextIndex >= ids.length) {
        return { ...state, stage: { ...state.stage, ended: true, chromeHidden: false } };
      }
      const nextId = ids[nextIndex];
```

Change the early-return to a true no-op:

```ts
    case "STAGE_ADVANCE": {
      const setlist = state.setlists.find((sl) => sl.id === state.stage.setlistId);
      if (!setlist) return state;
      const ids = flattenSongIds(setlist);
      const nextIndex = state.stage.setlistIndex + 1;
      if (nextIndex >= ids.length) return state;
      const nextId = ids[nextIndex];
```

Also drop the now-unnecessary `ended: false` from the rest of that case (three lines below):

```ts
      return {
        ...state,
        stage: { ...state.stage, songId: nextId, setlistIndex: nextIndex, dispKey, ended: false, view: defaultView(song) },
      };
    }
```

becomes:

```ts
      return {
        ...state,
        stage: { ...state.stage, songId: nextId, setlistIndex: nextIndex, dispKey, view: defaultView(song) },
      };
    }
```

(`defaultView` here is renamed to `resolveDefaultView` in Task 8 — leave it as `defaultView` for now, Task 8 does a single rename pass across all call sites.)

- [ ] **Step 2: Remove `STAGE_REPLAY` entirely**

Delete its case from the reducer:

```ts
    case "STAGE_REPLAY": {
      const setlist = state.setlists.find((sl) => sl.id === state.stage.setlistId);
      if (!setlist) return state;
      const ids = flattenSongIds(setlist);
      const song = state.songs.find((s) => s.id === ids[0]);
      return {
        ...state,
        stage: { ...state.stage, songId: ids[0], setlistIndex: 0, dispKey: song?.defaultKey ?? null, ended: false, view: defaultView(song) },
      };
    }
```

Delete its entry from the `Action` union:

```ts
  | { type: "STAGE_REPLAY" }
```

- [ ] **Step 3: Remove `ended` from `StageState` and `makeEmptyStage`**

In `src/state/types.ts`, `StageState` currently reads:

```ts
export interface StageState {
  songId: string | null;
  setlistId: string | null;
  setlistIndex: number; // index of the current song within the flattened song list of the active setlist
  dispKey: string | null;
  capo: number;
  view: ChartView;
  toolbarExpanded: boolean;
  drawer: Drawer;
  chromeHidden: boolean;
  ended: boolean;
  lyricsOnly: boolean;
  zoom: number;
}
```

Remove the `ended: boolean;` line (leave `toolbarExpanded` — Task 5 removes it):

```ts
export interface StageState {
  songId: string | null;
  setlistId: string | null;
  setlistIndex: number; // index of the current song within the flattened song list of the active setlist
  dispKey: string | null;
  capo: number;
  view: ChartView;
  toolbarExpanded: boolean;
  drawer: Drawer;
  chromeHidden: boolean;
  lyricsOnly: boolean;
  zoom: number;
}
```

Back in `src/state/store.ts`, `makeEmptyStage` currently reads:

```ts
export function makeEmptyStage(textScale: number): StageState {
  return {
    songId: defaultSong ? DEFAULT_SONG_ID : null,
    setlistId: null,
    setlistIndex: 0,
    dispKey: defaultSong?.defaultKey ?? null,
    capo: 0,
    view: defaultView(defaultSong),
    toolbarExpanded: false,
    drawer: null,
    chromeHidden: false,
    ended: false,
    lyricsOnly: false,
    zoom: textScale,
  };
}
```

Remove `ended: false,`:

```ts
export function makeEmptyStage(textScale: number): StageState {
  return {
    songId: defaultSong ? DEFAULT_SONG_ID : null,
    setlistId: null,
    setlistIndex: 0,
    dispKey: defaultSong?.defaultKey ?? null,
    capo: 0,
    view: defaultView(defaultSong),
    toolbarExpanded: false,
    drawer: null,
    chromeHidden: false,
    lyricsOnly: false,
    zoom: textScale,
  };
}
```

- [ ] **Step 4: Remove the "Set complete" screen and every other `stage.ended`/`STAGE_REPLAY` reference**

In `src/screens/live-stage/LiveStage.tsx`, delete the entire branch:

```tsx
  if (stage.ended && setlist) {
    const path = setlistSongIds.map((id) => state.songs.find((s) => s.id === id)?.defaultKey).join(" → ");
    return (
      <div className="screen" onClick={resetIdle}>
        <div className="hdr tinted">
          <span className="live-badge active">
            <span className="dot" />
            LIVE
          </span>
        </div>
        <div className="empty">
          <div className="empty-title">Set complete</div>
          <div className="empty-body">
            {path} · {setlistSongIds.length} songs
          </div>
          <div className="btn-row" style={{ flexDirection: "column" }}>
            <button className="btn btn-primary" onClick={() => nav.push("setlist-detail", { setlistId: setlist.id })}>
              Back to setlist
            </button>
            <button className="btn" onClick={() => dispatch({ type: "STAGE_REPLAY" })}>
              Replay from song 1
            </button>
          </div>
        </div>
      </div>
    );
  }

```

(Delete the whole `if` block, including its trailing blank line — what remains directly above it is the idle-reset `useEffect`'s closing line, edited below, and directly below it is the existing `if (!song) { ... }` branch.)

Then update the idle-reset effect, which currently reads:

```ts
  const resetIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (stage.chromeHidden) dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: false });
    if (song && !stage.ended && stage.drawer !== "annotate") {
      idleTimer.current = setTimeout(() => dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: true }), IDLE_MS);
    }
  };

  useEffect(() => {
    resetIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.songId, stage.ended, stage.drawer]);
```

Remove the two `stage.ended` references:

```ts
  const resetIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (stage.chromeHidden) dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: false });
    if (song && stage.drawer !== "annotate") {
      idleTimer.current = setTimeout(() => dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: true }), IDLE_MS);
    }
  };

  useEffect(() => {
    resetIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.songId, stage.drawer]);
```

- [ ] **Step 5: Verify**

Run: `npm run build` — expect clean (confirms no other file referenced `stage.ended`/`STAGE_REPLAY`).
Run: `npm run dev`. Load the "Sunday AM" setlist (or any multi-song setlist) onto Live Stage, swipe/advance through every song. On the last song, trigger the forward-advance gesture again (swipe left, or however your test harness triggers `STAGE_ADVANCE`) — confirm the last song simply stays on screen with no dead-end screen and no console error.

- [ ] **Step 6: Commit**

```bash
git add src/state/types.ts src/state/store.ts src/screens/live-stage/LiveStage.tsx
git commit -m "Make advancing past a setlist's last song a no-op instead of showing a Set complete screen"
```

---

### Task 4: Scope Light/Stage-Dark theming — white base, fixed-light sheet view

**Files:**
- Modify: `src/theme.css`
- Modify: `src/screens/live-stage/LiveStage.tsx`

**Interfaces:**
- Produces: `--sheet-bg`, `--sheet-fg`, `--sheet-mut` CSS custom properties (same value in both `[data-theme="light"]` and `[data-theme="dark"]`, so they never flip) — used by `LiveStage.tsx`'s sheet-view rendering.

- [ ] **Step 1: Make light mode's base background true white**

In `src/theme.css`, `.device[data-theme="light"]` currently reads:

```css
.device[data-theme="light"] {
  --bg: #f2f2f3;
  --fg: #1d1f20;
```

Change `--bg` to:

```css
.device[data-theme="light"] {
  --bg: #ffffff;
  --fg: #1d1f20;
```

- [ ] **Step 2: Add fixed-light tokens to both theme blocks**

Still in `.device[data-theme="light"]`, add three new lines anywhere inside the block (after `--knob: #ffffff;` reads naturally):

```css
  --knob: #ffffff;
  --sheet-bg: #ffffff;
  --sheet-fg: #1d1f20;
  --sheet-mut: #7a7a7d;
}
```

In `.device[data-theme="dark"]`, add the **same values** (this is what makes them theme-invariant — Stage Dark must not darken the sheet view):

```css
  --knob: #f5f5f8;
  --sheet-bg: #ffffff;
  --sheet-fg: #1d1f20;
  --sheet-mut: #7a7a7d;
}
```

- [ ] **Step 3: Apply the fixed background/text colors to the sheet-view content area**

In `src/screens/live-stage/LiveStage.tsx`, the scrollable chart container currently reads:

```tsx
      <div
        className="flex-1 hidden-scroll"
        style={{
          padding: "16px 14px 150px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          touchAction: "pan-y",
        }}
        onPointerDown={onChartPointerDown}
        onPointerUp={onChartPointerUp}
      >
```

Change its `style` so it switches to the fixed-light background/text whenever Sheet view is active (this covers the padding gutters too, so there's no two-tone navy-border/white-center mismatch in Stage Dark):

```tsx
      <div
        className="flex-1 hidden-scroll"
        style={{
          padding: "16px 14px 150px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          touchAction: "pan-y",
          background: stage.view === "sheet" ? "var(--sheet-bg)" : undefined,
          color: stage.view === "sheet" ? "var(--sheet-fg)" : undefined,
        }}
        onPointerDown={onChartPointerDown}
        onPointerUp={onChartPointerUp}
      >
```

A few lines below, the attached-content caption currently reads:

```tsx
            <span className="muted" style={{ fontSize: 11 }}>
              {activeKind === "musicxml"
                ? `${activeVersion.name} · engraved from the score, no chords detected`
                : `${activeVersion.name} · saved as-is, no chords detected`}
            </span>
```

`.muted`'s `color: var(--mut)` would otherwise win over the inherited color above (explicit class rules beat inheritance). Override it inline:

```tsx
            <span style={{ fontSize: 11, color: "var(--sheet-mut)" }}>
              {activeKind === "musicxml"
                ? `${activeVersion.name} · engraved from the score, no chords detected`
                : `${activeVersion.name} · saved as-is, no chords detected`}
            </span>
```

And the "no sheet music attached" empty state (reached when Sheet view is active but the song has no attachments) currently reads:

```tsx
        ) : (
          <div className="empty">
            <div className="empty-title">No sheet music attached</div>
            <div className="empty-body">Attach a PDF, photo, or MusicXML score from Add/Edit Song to see it here.</div>
          </div>
        )}
```

`.empty-body` also has its own explicit `color: var(--mut)` rule that would otherwise win — override both lines inline:

```tsx
        ) : (
          <div className="empty">
            <div className="empty-title" style={{ color: "var(--sheet-fg)" }}>No sheet music attached</div>
            <div className="empty-body" style={{ color: "var(--sheet-mut)" }}>Attach a PDF, photo, or MusicXML score from Add/Edit Song to see it here.</div>
          </div>
        )}
```

The chords/lyrics branch (`stage.view === "chords"`, rendering `<ChordChart .../>`) is untouched — the ternary's other two branches only fire when `stage.view === "sheet"`, matching the `background`/`color` condition above exactly.

- [ ] **Step 4: Verify**

Run: `npm run build` — expect clean.
Run: `npm run dev`. Open a song with an attached PDF/photo/score onto Live Stage.
  1. In Light mode, compare the Sheet view's background to a card/surface elsewhere in the app (e.g. a Library row) — should read as the same white.
  2. Switch to Stage Dark (via the dev-preview Appearance toggle). Confirm the header/tab-bar/chord-view still darken as before, but switching to Sheet view shows a light panel with dark, readable text (title, caption, and — for a song with no attachment — the empty-state text) rather than pale text on white.
  3. Switch back to Chords view in Stage Dark and confirm it's unaffected (still dark background, light text, as before this task).

- [ ] **Step 5: Commit**

```bash
git add src/theme.css src/screens/live-stage/LiveStage.tsx
git commit -m "Make Live Stage's base background white and stop Stage Dark from darkening the Sheet Music/PDF/Photo view"
```

---

### Task 5: Consolidate the toolbar, song-title toggle, and sheet selector into one Stage tools sheet

**Files:**
- Modify: `src/screens/live-stage/MusicToolbar.tsx`
- Create: `src/screens/live-stage/StageToolsSheet.tsx`
- Modify: `src/screens/live-stage/LiveStage.tsx`
- Modify: `src/state/types.ts`
- Modify: `src/state/store.ts`
- Delete: `src/screens/live-stage/InstrumentFilterModal.tsx`

**Interfaces:**
- Consumes: `Sheet` from `src/components/Overlays.tsx` (`{ children, onClose? }`); `Icon`/`IconName` from `src/components/Icon.tsx`; `ATTACHMENT_LABEL`, `CATEGORY_PRIORITY`, `selectedVersion` from `src/utils/attachments.ts`; `ScoreInstrument` from `src/components/MxlScore.tsx`.
- Produces: `MusicToolbar` now takes `{ transposeLocked: boolean; onOpenTools: () => void }` (was `{ view, hasChords, instruments, hiddenParts, onToggleInstrument, transposeLocked, chordsLocked, instrumentsLocked, onAddSong, onQuickEdit, onAnnotate }`). New `StageToolsSheet` component, described below, consumed only by `LiveStage.tsx`.

**A note on scope:** while removing the song-title row's Chord/Sheet toggle block, this task also deletes a dead code path: the "Parts · 2/3" chip and its `InstrumentFilterModal`/`partsOpen` trigger. That chip only renders when `stage.view === "sheet"` and `activeKind` is `undefined` — but `activeKind` is only ever `undefined` when the song has no attachments at all, in which case the Sheet toggle button is `disabled` and `stage.view` can never become `"sheet"` in the first place (`defaultView()`/`resolveDefaultView()` only pick `"sheet"` when attachments exist). It's unreachable under current logic, uses its own hardcoded static instrument list disconnected from any real song data, and lives in exactly the block this task must rewrite — so it's removed rather than carried forward. This is unrelated to the *real*, working instrument show/hide feature (`scoreInstruments`/`hiddenParts`, driven by `MxlScore`'s `onInstrumentsChange`), which this task preserves and moves into the new sheet.

- [ ] **Step 1: Slim `MusicToolbar.tsx` down to the one-row bottom bar**

Replace the entire contents of `src/screens/live-stage/MusicToolbar.tsx` with:

```tsx
import { KeyChips } from "../../components/KeyChips";
import { Icon } from "../../components/Icon";
import { useStore } from "../../state/store";

export function MusicToolbar({
  transposeLocked,
  onOpenTools,
}: {
  /** Disables the key-transpose row — locked once either the "chords" or
   * "musicxml" annotation layer has strokes, since both views share the
   * same `stage.dispKey`. */
  transposeLocked: boolean;
  onOpenTools: () => void;
}) {
  const { state, dispatch } = useStore();
  const { stage } = state;
  const key = stage.dispKey ?? "C";

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        borderTop: "1px solid var(--line)",
        background: "var(--surface)",
        zIndex: 6,
        padding: "8px 10px 10px",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <KeyChips active={key} onSelect={(k) => dispatch({ type: "STAGE_SET_KEY", key: k })} disabled={transposeLocked} />
        </div>
        <button
          onClick={onOpenTools}
          aria-label="Stage tools"
          style={{
            flex: "none",
            width: 36,
            height: 36,
            borderRadius: 9,
            border: "1px solid var(--line)",
            background: "var(--bg)",
            color: "var(--acc)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="more" size={18} strokeWidth={1.8} />
        </button>
      </div>
      {transposeLocked && (
        <div style={{ fontSize: 11, color: "var(--mut)", marginTop: 4 }}>Clear marks in Annotate to change key.</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `StageToolsSheet.tsx`**

Create `src/screens/live-stage/StageToolsSheet.tsx`:

```tsx
import { useState } from "react";
import { Sheet } from "../../components/Overlays";
import { Icon, type IconName } from "../../components/Icon";
import { useStore } from "../../state/store";
import type { ScoreInstrument } from "../../components/MxlScore";
import type { AttachmentKind, ChartView, Song } from "../../state/types";
import { ATTACHMENT_LABEL, selectedVersion } from "../../utils/attachments";

export function StageToolsSheet({
  song,
  view,
  hasChords,
  availableKinds,
  activeKind,
  activeVersionId,
  onSelectChords,
  onSelectSheet,
  instruments,
  hiddenParts,
  onToggleInstrument,
  chordsLocked,
  instrumentsLocked,
  onAddSong,
  onQuickEdit,
  onAnnotate,
  onClose,
}: {
  song: Song;
  view: ChartView;
  hasChords: boolean;
  availableKinds: AttachmentKind[];
  activeKind: AttachmentKind | undefined;
  activeVersionId: string | undefined;
  onSelectChords: () => void;
  onSelectSheet: (kind: AttachmentKind, versionId?: string) => void;
  instruments: ScoreInstrument[];
  hiddenParts: ReadonlySet<string>;
  onToggleInstrument: (id: string) => void;
  /** Disables capo/lyrics-only/zoom — locked once the "chords" annotation
   * layer has strokes. */
  chordsLocked: boolean;
  /** Disables the instrument show/hide chips — locked once the "musicxml"
   * annotation layer has strokes. */
  instrumentsLocked: boolean;
  onAddSong: () => void;
  onQuickEdit: () => void;
  onAnnotate: () => void;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const { stage } = state;
  const [expandedKind, setExpandedKind] = useState<AttachmentKind | null>(null);

  // Nothing to switch between — a song with chords and no attachments (or
  // vice versa) doesn't need a picker at all.
  const showViewPicker = (hasChords ? 1 : 0) + availableKinds.length > 1;
  // Same condition MusicToolbar's old expanded second row used: chord view
  // always has something to configure once there are chords; sheet view
  // only does once there's more than one instrument part.
  const showSecondRow = view === "chords" ? hasChords : instruments.length > 1;

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Stage tools</div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
        <ToolIcon icon="plus" label="Add song" onClick={run(onAddSong)} />
        <ToolIcon icon="edit" label="Quick edit" onClick={run(onQuickEdit)} />
        <ToolIcon icon="annotate" label="Annotate" onClick={run(onAnnotate)} />
      </div>

      {showViewPicker && (
        <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 2 }}>
          {hasChords && (
            <button className="sheet-row" onClick={run(onSelectChords)}>
              <span>Chords/Lyrics</span>
              <span className="accent-deep" style={{ opacity: view === "chords" ? 1 : 0, display: "flex" }}>
                <Icon name="check" size={14} strokeWidth={2.2} />
              </span>
            </button>
          )}
          {availableKinds.map((kind) => {
            const bucket = song.attachments[kind]!;
            const isMultiVersion = bucket.versions.length > 1;
            const isActiveKind = view === "sheet" && activeKind === kind;
            const activeVersionLabel = isActiveKind ? bucket.versions.find((v) => v.id === activeVersionId)?.label : undefined;
            const activeLabel = activeVersionLabel ?? selectedVersion(bucket).label;
            return (
              <div key={kind}>
                <button
                  className="sheet-row"
                  onClick={
                    isMultiVersion
                      ? () => setExpandedKind(expandedKind === kind ? null : kind)
                      : run(() => onSelectSheet(kind))
                  }
                >
                  <span>
                    {ATTACHMENT_LABEL[kind]}
                    {isMultiVersion && <span className="muted"> · {activeLabel}</span>}
                  </span>
                  {isMultiVersion ? (
                    <span
                      style={{
                        display: "flex",
                        color: "var(--mut)",
                        transform: expandedKind === kind ? "rotate(90deg)" : undefined,
                        transition: "transform .15s",
                      }}
                    >
                      <Icon name="chevron-right" size={14} strokeWidth={2} />
                    </span>
                  ) : (
                    <span className="accent-deep" style={{ opacity: isActiveKind ? 1 : 0, display: "flex" }}>
                      <Icon name="check" size={14} strokeWidth={2.2} />
                    </span>
                  )}
                </button>
                {isMultiVersion && expandedKind === kind && (
                  <div style={{ paddingLeft: 14 }}>
                    {bucket.versions.map((v) => (
                      <button key={v.id} className="sheet-row" onClick={run(() => onSelectSheet(kind, v.id))}>
                        <span>{v.label}</span>
                        <span className="accent-deep" style={{ opacity: isActiveKind && v.id === activeVersionId ? 1 : 0, display: "flex" }}>
                          <Icon name="check" size={14} strokeWidth={2.2} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showSecondRow && view === "chords" && (
        <div style={{ opacity: chordsLocked ? 0.4 : 1 }}>
          <div style={{ padding: "9px 2px 4px", display: "flex", alignItems: "center", gap: 2 }}>
            <ToolbarStepper
              label="Capo"
              value={stage.capo}
              disabled={chordsLocked}
              onDec={() => dispatch({ type: "STAGE_SET_CAPO", capo: stage.capo - 1 })}
              onInc={() => dispatch({ type: "STAGE_SET_CAPO", capo: stage.capo + 1 })}
            />
            <ToolIcon
              glyph="Aa"
              label="Lyrics"
              active={stage.lyricsOnly}
              disabled={chordsLocked}
              onClick={() => dispatch({ type: "STAGE_TOGGLE_LYRICS_ONLY" })}
            />
            <ToolIcon
              glyph="－"
              label="Zoom−"
              disabled={chordsLocked}
              onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom - 10 })}
            />
            <ToolIcon
              glyph="＋"
              label="Zoom+"
              disabled={chordsLocked}
              onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom + 10 })}
            />
          </div>
          {chordsLocked && (
            <div style={{ fontSize: 11, color: "var(--mut)", padding: "0 2px 6px" }}>
              Clear marks in Annotate to change these controls.
            </div>
          )}
        </div>
      )}

      {showSecondRow && view === "sheet" && (
        <div>
          <div style={{ padding: "9px 2px 4px", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {instruments.map((inst) => (
              <button
                key={inst.id}
                className={"chip" + (hiddenParts.has(inst.id) ? "" : " active")}
                disabled={instrumentsLocked}
                style={{ opacity: instrumentsLocked ? 0.4 : 1 }}
                onClick={() => onToggleInstrument(inst.id)}
              >
                {inst.name}
              </button>
            ))}
          </div>
          {instrumentsLocked && (
            <div style={{ fontSize: 11, color: "var(--mut)", padding: "0 2px 6px" }}>
              Clear marks in Annotate to show/hide parts.
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function ToolbarStepper({
  label,
  value,
  onDec,
  onInc,
  disabled = false,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={onDec}
          disabled={disabled}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1.5px solid var(--acc)",
            color: "var(--acc)",
            background: "none",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          −
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--acc)", minWidth: 16, textAlign: "center" }}>{value}</span>
        <button
          onClick={onInc}
          disabled={disabled}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1.5px solid var(--acc)",
            color: "var(--acc)",
            background: "none",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          +
        </button>
      </div>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--mut)" }}>{label}</span>
    </div>
  );
}

function ToolIcon({
  glyph,
  icon,
  label,
  onClick,
  active,
  disabled = false,
}: {
  glyph?: string;
  icon?: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        flex: 1,
        background: "none",
        border: "none",
      }}
    >
      <span style={{ fontSize: 19, lineHeight: 1, display: "flex", color: active ? "var(--acc-deep)" : "var(--acc)" }}>
        {icon ? <Icon name={icon} size={19} strokeWidth={1.8} /> : glyph}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--mut)" }}>{label}</span>
    </button>
  );
}
```

- [ ] **Step 3: Delete the dead `InstrumentFilterModal`**

```bash
git rm src/screens/live-stage/InstrumentFilterModal.tsx
```

- [ ] **Step 4: Rewire `LiveStage.tsx`**

Remove the `InstrumentFilterModal` import and add the new `StageToolsSheet` import. Current imports:

```tsx
import { AddSongDrawer } from "./AddSongDrawer";
import { QuickEditSheet } from "./QuickEditSheet";
import { InstrumentFilterModal } from "./InstrumentFilterModal";
import { MusicToolbar } from "./MusicToolbar";
import { AnnotateScreen } from "./AnnotateScreen";
```

Change to:

```tsx
import { AddSongDrawer } from "./AddSongDrawer";
import { QuickEditSheet } from "./QuickEditSheet";
import { MusicToolbar } from "./MusicToolbar";
import { StageToolsSheet } from "./StageToolsSheet";
import { AnnotateScreen } from "./AnnotateScreen";
```

`Icon` and `Sheet` are still imported at the top (`import { Icon } from "../../components/Icon";` / `import { Sheet } from "../../components/Overlays";`) but become unused once the version-picker `Sheet` block below is removed — remove both of those two import lines too (nothing else in this file uses `Icon` or `Sheet` after this task).

The attachments-utils import line currently reads:

```ts
import { ATTACHMENT_LABEL, CATEGORY_PRIORITY, firstAvailableCategory, selectedVersion } from "../../utils/attachments";
```

`ATTACHMENT_LABEL` was only ever used in this file inside the song-title-row block and the version-picker `Sheet` block, both removed below — `CATEGORY_PRIORITY`, `firstAvailableCategory`, and `selectedVersion` all stay in use elsewhere in this file. Drop just `ATTACHMENT_LABEL`:

```ts
import { CATEGORY_PRIORITY, firstAvailableCategory, selectedVersion } from "../../utils/attachments";
```

Replace the local state block. Currently:

```tsx
  const [partsOpen, setPartsOpen] = useState(false);
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  const [scoreInstruments, setScoreInstruments] = useState<ScoreInstrument[]>([]);
```

Change to:

```tsx
  const [stageToolsOpen, setStageToolsOpen] = useState(false);
  const [scoreInstruments, setScoreInstruments] = useState<ScoreInstrument[]>([]);
```

Remove the `onScreenClick` toolbar-collapse logic. Currently:

```tsx
  const onScreenClick = () => {
    resetIdle();
    if (stage.toolbarExpanded) dispatch({ type: "STAGE_TOGGLE_TOOLBAR" });
  };
```

Change to:

```tsx
  const onScreenClick = () => {
    resetIdle();
  };
```

Replace the song-title row block. Currently (the whole `<div style={{display:"flex", justifyContent:"space-between", ...}}>...` block through its matching closing `</div>`, plus the two chip-row blocks right after it):

```tsx
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "10px 14px 8px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 19 }}>{song.title}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {song.artist}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flex: "none" }}>
              <div style={{ display: "flex", gap: 2, background: "var(--line)", borderRadius: 8, padding: 3 }}>
                <button
                  disabled={!hasChords}
                  onClick={() => dispatch({ type: "STAGE_SET_VIEW", view: "chords" })}
                  style={{
                    fontSize: 11,
                    padding: "4px 11px",
                    borderRadius: 5,
                    border: "none",
                    fontWeight: 700,
                    opacity: hasChords ? 1 : 0.35,
                    background: stage.view === "chords" ? "var(--acc)" : "transparent",
                    color: stage.view === "chords" ? "var(--onacc)" : "var(--mut)",
                  }}
                >
                  Chord
                </button>
                <button
                  disabled={availableKinds.length === 0}
                  onClick={() => dispatch({ type: "STAGE_SET_VIEW", view: "sheet" })}
                  style={{
                    fontSize: 11,
                    padding: "4px 11px",
                    borderRadius: 5,
                    border: "none",
                    fontWeight: 700,
                    opacity: availableKinds.length === 0 ? 0.35 : 1,
                    background: stage.view === "sheet" ? "var(--acc)" : "transparent",
                    color: stage.view === "sheet" ? "var(--onacc)" : "var(--mut)",
                  }}
                >
                  {activeKind ? ATTACHMENT_LABEL[activeKind] : "Sheet"}
                </button>
              </div>
              {stage.view === "chords" ? (
                <div className="accent-deep" style={{ fontSize: 10, fontWeight: 700 }}>
                  Key of {stage.dispKey}
                </div>
              ) : activeKind ? (
                <div className="muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>
                  {ATTACHMENT_LABEL[activeKind].toUpperCase()}
                </div>
              ) : (
                <button
                  className="chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPartsOpen(true);
                  }}
                >
                  Parts · 2/3
                </button>
              )}
            </div>
      </div>

      {stage.view === "sheet" && availableKinds.length > 1 && (
        <div style={{ display: "flex", gap: 6, padding: "0 14px 8px" }}>
          {availableKinds.map((k) => (
            <button
              key={k}
              className={"chip" + (activeKind === k ? " active" : "")}
              onClick={(e) => {
                e.stopPropagation();
                setActiveKind(k);
                setActiveVersionId(selectedVersion(song.attachments[k]!).id);
              }}
            >
              {ATTACHMENT_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {stage.view === "sheet" && activeBucket && activeVersion && activeBucket.versions.length > 1 && (
        <div style={{ padding: "0 14px 8px" }}>
          <button
            className="chip"
            style={{ borderColor: "var(--acc-deep)", color: "var(--acc-deep)" }}
            onClick={(e) => {
              e.stopPropagation();
              setVersionPickerOpen(true);
            }}
          >
            ▾ {activeVersion.label}
          </button>
        </div>
      )}
```

Replace all of that with just the title/artist:

```tsx
      <div style={{ padding: "10px 14px 8px" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 19 }}>{song.title}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          {song.artist}
        </div>
      </div>
```

Add two handler functions right after `goToSongOffset` (used by the new sheet's view picker — keeps the dispatch/local-state wiring in `LiveStage.tsx`, which already owns `activeKind`/`activeVersionId`):

```tsx
  const selectChordsView = () => {
    dispatch({ type: "STAGE_SET_VIEW", view: "chords" });
  };
  const selectSheetView = (kind: AttachmentKind, versionId?: string) => {
    setActiveKind(kind);
    setActiveVersionId(versionId ?? selectedVersion(song.attachments[kind]!).id);
    dispatch({ type: "STAGE_SET_VIEW", view: "sheet" });
  };
```

Update the `MusicToolbar` render and everything after it. Currently:

```tsx
      {!stage.chromeHidden && (hasChords || hasScore) && (
        <MusicToolbar
          view={stage.view}
          hasChords={hasChords}
          instruments={scoreInstruments}
          hiddenParts={hiddenParts}
          onToggleInstrument={toggleInstrument}
          transposeLocked={transposeLocked}
          chordsLocked={chordsAnnotated}
          instrumentsLocked={musicxmlAnnotated}
          onAddSong={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })}
          onQuickEdit={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "quick-edit" })}
          onAnnotate={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "annotate" })}
        />
      )}

      {stage.drawer === "add-song" && (
        <AddSongDrawer onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stage.drawer === "quick-edit" && (
        <QuickEditSheet songId={song.id} onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {partsOpen && <InstrumentFilterModal onClose={() => setPartsOpen(false)} />}
      {versionPickerOpen && activeKind && activeBucket && (
        <Sheet onClose={() => setVersionPickerOpen(false)}>
          <div className="sheet-title">{ATTACHMENT_LABEL[activeKind]} versions</div>
          {activeBucket.versions.map((v) => (
            <button
              key={v.id}
              className="sheet-row"
              onClick={() => {
                setActiveVersionId(v.id);
                setVersionPickerOpen(false);
              }}
            >
              <span>
                {v.label} <span className="muted">· {v.name}</span>
              </span>
              <span className="accent-deep" style={{ opacity: v.id === activeVersionId ? 1 : 0, display: "flex" }}>
                <Icon name="check" size={14} strokeWidth={2.2} />
              </span>
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}
```

Change to:

```tsx
      {!stage.chromeHidden && (hasChords || hasScore) && (
        <MusicToolbar transposeLocked={transposeLocked} onOpenTools={() => setStageToolsOpen(true)} />
      )}

      {stage.drawer === "add-song" && (
        <AddSongDrawer onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stage.drawer === "quick-edit" && (
        <QuickEditSheet songId={song.id} onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stageToolsOpen && (
        <StageToolsSheet
          song={song}
          view={stage.view}
          hasChords={hasChords}
          availableKinds={availableKinds}
          activeKind={activeKind}
          activeVersionId={activeVersionId}
          onSelectChords={selectChordsView}
          onSelectSheet={selectSheetView}
          instruments={scoreInstruments}
          hiddenParts={hiddenParts}
          onToggleInstrument={toggleInstrument}
          chordsLocked={chordsAnnotated}
          instrumentsLocked={musicxmlAnnotated}
          onAddSong={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })}
          onQuickEdit={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "quick-edit" })}
          onAnnotate={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "annotate" })}
          onClose={() => setStageToolsOpen(false)}
        />
      )}
    </div>
  );
}
```

Note `activeBucket`/`activeVersion` (computed earlier in the component, around where `availableKinds` is defined) are still used elsewhere in this file (the sheet-content render branch further down) — leave those two `const` lines alone.

- [ ] **Step 5: Remove `toolbarExpanded`/`STAGE_TOGGLE_TOOLBAR` now that nothing reads them**

In `src/state/types.ts`, `StageState` currently reads (after Task 3's edit):

```ts
export interface StageState {
  songId: string | null;
  setlistId: string | null;
  setlistIndex: number; // index of the current song within the flattened song list of the active setlist
  dispKey: string | null;
  capo: number;
  view: ChartView;
  toolbarExpanded: boolean;
  drawer: Drawer;
  chromeHidden: boolean;
  lyricsOnly: boolean;
  zoom: number;
}
```

Remove `toolbarExpanded: boolean;`:

```ts
export interface StageState {
  songId: string | null;
  setlistId: string | null;
  setlistIndex: number; // index of the current song within the flattened song list of the active setlist
  dispKey: string | null;
  capo: number;
  view: ChartView;
  drawer: Drawer;
  chromeHidden: boolean;
  lyricsOnly: boolean;
  zoom: number;
}
```

In `src/state/store.ts`, remove `toolbarExpanded: false,` from `makeEmptyStage`:

```ts
export function makeEmptyStage(textScale: number): StageState {
  return {
    songId: defaultSong ? DEFAULT_SONG_ID : null,
    setlistId: null,
    setlistIndex: 0,
    dispKey: defaultSong?.defaultKey ?? null,
    capo: 0,
    view: defaultView(defaultSong),
    drawer: null,
    chromeHidden: false,
    lyricsOnly: false,
    zoom: textScale,
  };
}
```

Remove the `STAGE_TOGGLE_TOOLBAR` entry from the `Action` union:

```ts
  | { type: "STAGE_TOGGLE_TOOLBAR" }
```

Remove its reducer case:

```ts
    case "STAGE_TOGGLE_TOOLBAR":
      return { ...state, stage: { ...state.stage, toolbarExpanded: !state.stage.toolbarExpanded } };
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: clean. This is the step most likely to surface a missed reference — if it fails, search the error for `toolbarExpanded`, `partsOpen`, `versionPickerOpen`, `InstrumentFilterModal`, `onAddSong`/`onQuickEdit`/`onAnnotate` (as `MusicToolbar` props, not `StageToolsSheet` props) and fix the stray reference.

- [ ] **Step 7: Manual click-through**

Run: `npm run dev`. Open a song with chords AND an attached PDF with two+ versions onto Live Stage.
  1. Confirm the bottom bar is one row: key chips + a "⋯"-style trigger button, directly above the tab bar.
  2. Tap the trigger. Confirm the sheet shows, top to bottom: Add song / Quick edit / Annotate icons; a view picker listing "Chords/Lyrics" and the attachment kind(s); then (in chord view) Capo/Lyrics-only/Zoom.
  3. Tap the PDF row (its version count > 1) — confirm it expands in place to show each version, without closing the sheet or changing what's on screen yet.
  4. Tap a version row — confirm the sheet closes and Live Stage now shows that PDF version.
  5. Reopen the sheet, tap "Chords/Lyrics" — confirm it closes and Live Stage returns to the chord chart.
  6. Tap "Add song"/"Quick edit"/"Annotate" each in turn (reopening the sheet between) — confirm each still opens its target exactly as before this task.
  7. Load a song whose only annotation layer has strokes (so `chordsLocked`/`instrumentsLocked` is true) and confirm the sheet's locked-state messaging still appears, matching pre-task behavior.
  8. Load a song with chords but no attachments — confirm the view picker section doesn't render at all (nothing to pick between), while the icon row still does.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Consolidate Live Stage's toolbar, song-title toggle, and sheet selector into one Stage tools sheet"
```

---

### Task 6: Add real iPad Air 11″/13″ dev-preview viewports

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/DeviceNotch.tsx`
- Modify: `src/theme.css`

**Interfaces:**
- Produces: `Viewport = "phone" | "ipadAir11" | "ipadAir13"` (was `"phone" | "tablet"`) — consumed by `App.tsx`, `DeviceNotch.tsx`, `theme.css`, and `store.ts`'s `initialState`/`hydrateState` (both already just assign the string literal `"phone"`, which is unaffected by this rename).

- [ ] **Step 1: Rename the `Viewport` type**

In `src/state/types.ts`:

```ts
export type Viewport = "phone" | "tablet";
```

Change to:

```ts
export type Viewport = "phone" | "ipadAir11" | "ipadAir13";
```

- [ ] **Step 2: Update `App.tsx`'s viewport dimensions and toggle buttons**

In `src/App.tsx`, `VIEWPORT_VARS` currently reads:

```ts
const VIEWPORT_VARS = {
  phone: { fw: "402px", fh: "874px", statusH: "48px" },
  tablet: { fw: "512.5px", fh: "737.5px", statusH: "24px" },
};
```

Change to (real logical-point/CSS-px resolutions, both portrait: iPad Air 11″ M2 = 820×1180, iPad Air 13″ M2 = 1024×1366):

```ts
const VIEWPORT_VARS = {
  phone: { fw: "402px", fh: "874px", statusH: "48px" },
  ipadAir11: { fw: "820px", fh: "1180px", statusH: "24px" },
  ipadAir13: { fw: "1024px", fh: "1366px", statusH: "24px" },
};
```

The dev-preview toggle row currently reads:

```tsx
        <div className="group">
          <span className="group-label">Viewport</span>
          <div className="seg-btn-row">
            <button
              className={"seg-btn" + (state.viewport === "phone" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: "phone" })}
            >
              Phone
            </button>
            <button
              className={"seg-btn" + (state.viewport === "tablet" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: "tablet" })}
            >
              Tablet
            </button>
          </div>
        </div>
```

Change to:

```tsx
        <div className="group">
          <span className="group-label">Viewport</span>
          <div className="seg-btn-row">
            <button
              className={"seg-btn" + (state.viewport === "phone" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: "phone" })}
            >
              Phone
            </button>
            <button
              className={"seg-btn" + (state.viewport === "ipadAir11" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: "ipadAir11" })}
            >
              iPad Air 11″
            </button>
            <button
              className={"seg-btn" + (state.viewport === "ipadAir13" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: "ipadAir13" })}
            >
              iPad Air 13″
            </button>
          </div>
        </div>
```

- [ ] **Step 3: Update `DeviceNotch.tsx`**

Currently:

```tsx
export function DeviceNotch({ viewport }: { viewport: Viewport }) {
  if (viewport === "tablet") {
    return <span className="camera-dot" aria-hidden="true" />;
  }
  return <span className="dynamic-island" aria-hidden="true" />;
}
```

Change to:

```tsx
export function DeviceNotch({ viewport }: { viewport: Viewport }) {
  if (viewport === "ipadAir11" || viewport === "ipadAir13") {
    return <span className="camera-dot" aria-hidden="true" />;
  }
  return <span className="dynamic-island" aria-hidden="true" />;
}
```

Its doc comment above the function mentions `"iPad A16"` by name — leave that comment as-is (still accurate in spirit: this is real-hardware detail for the mockup's frames), no change needed there beyond the code.

- [ ] **Step 4: Update the `theme.css` selector**

Currently:

```css
/* Tablet has room for all 12 without scrolling — fill the row exactly
   instead of the phone's fixed-width scrolling buttons. */
[data-viewport="tablet"] .key-row-btn {
  flex: 1;
  width: auto;
  min-width: 0;
}
```

Change to:

```css
/* Both iPad Air sizes have room for all 12 without scrolling — fill the
   row exactly instead of the phone's fixed-width scrolling buttons. */
[data-viewport="ipadAir11"] .key-row-btn,
[data-viewport="ipadAir13"] .key-row-btn {
  flex: 1;
  width: auto;
  min-width: 0;
}
```

- [ ] **Step 5: Verify**

Run: `npm run build` — expect clean.
Run: `npm run dev`. In the dev-preview harness, confirm three viewport buttons: Phone, iPad Air 11″, iPad Air 13″. Click each:
  1. Confirm the device frame resizes to the correct portrait aspect ratio for each (noticeably larger for the two iPad sizes than the old single "Tablet" option).
  2. On Live Stage, confirm the bottom key-chip row fills edge-to-edge (no horizontal scrolling) on both iPad sizes, same as the old "Tablet" did.
  3. Confirm the device notch renders as the plain camera-dot style (not the phone's Dynamic Island) on both iPad sizes.

- [ ] **Step 6: Commit**

```bash
git add src/state/types.ts src/App.tsx src/components/DeviceNotch.tsx src/theme.css
git commit -m "Replace the generic Tablet dev-preview viewport with real iPad Air 11-inch and 13-inch sizes"
```

---

### Task 7: Add the "Default on Live Stage" picker to Add/Edit Song

**Files:**
- Modify: `src/screens/add-edit-song/AddEditSong.tsx`

**Interfaces:**
- Consumes: `Song.defaultView` (Task 1); `CATEGORY_PRIORITY`, `ATTACHMENT_LABEL` from `src/utils/attachments.ts` (already imported in this file).
- Produces: songs saved from this screen now carry a `defaultView` field. (Task 8 makes Live Stage actually honor it — this task only adds the picker and persists the choice.)

- [ ] **Step 1: Add local state for the picker**

In `src/screens/add-edit-song/AddEditSong.tsx`, the state block currently includes:

```ts
  const [attachments, setAttachments] = useState<Attachments>(hadPrefillAttachments ? prefillAttachments ?? {} : existing?.attachments ?? {});
  const [notes, setNotes] = useState(existing?.notes ?? "");
```

Add a new line between them:

```ts
  const [attachments, setAttachments] = useState<Attachments>(hadPrefillAttachments ? prefillAttachments ?? {} : existing?.attachments ?? {});
  const [defaultView, setDefaultView] = useState<Song["defaultView"]>(existing?.defaultView);
  const [notes, setNotes] = useState(existing?.notes ?? "");
```

- [ ] **Step 2: Track it in the dirty check**

The `dirty` computation currently reads:

```ts
  const dirty =
    title !== (existing?.title ?? "") ||
    artist !== (existing?.artist ?? "") ||
    chordpro !== (existing?.chordpro ?? "") ||
    chartFormat !== (existing?.chartFormat ?? "chords-over-lyrics") ||
    timeSig !== (existing?.timeSig ?? "4/4") ||
    notes !== (existing?.notes ?? "") ||
    JSON.stringify(attachments) !== JSON.stringify(existing?.attachments ?? {});
```

Add a line:

```ts
  const dirty =
    title !== (existing?.title ?? "") ||
    artist !== (existing?.artist ?? "") ||
    chordpro !== (existing?.chordpro ?? "") ||
    chartFormat !== (existing?.chartFormat ?? "chords-over-lyrics") ||
    timeSig !== (existing?.timeSig ?? "4/4") ||
    notes !== (existing?.notes ?? "") ||
    defaultView !== existing?.defaultView ||
    JSON.stringify(attachments) !== JSON.stringify(existing?.attachments ?? {});
```

- [ ] **Step 3: Include it when saving**

The `save()` function currently builds:

```ts
    const song: Song = {
      id: existing?.id ?? `song-${Date.now()}`,
      title: title.trim(),
      artist: artist.trim() || "Unknown",
      defaultKey: effectiveKey || "C",
      tempo: Number(tempo) || 80,
      timeSig: timeSig.trim() || "4/4",
      durationSec: existing?.durationSec ?? 240,
      favourite: existing?.favourite ?? false,
      source: (existing?.source ?? "typed") as SongSource,
      chordpro,
      chartFormat,
      attachments,
      notes,
      annotations: existing?.annotations ?? {},
    };
```

Add `defaultView,` after `attachments,`:

```ts
    const song: Song = {
      id: existing?.id ?? `song-${Date.now()}`,
      title: title.trim(),
      artist: artist.trim() || "Unknown",
      defaultKey: effectiveKey || "C",
      tempo: Number(tempo) || 80,
      timeSig: timeSig.trim() || "4/4",
      durationSec: existing?.durationSec ?? 240,
      favourite: existing?.favourite ?? false,
      source: (existing?.source ?? "typed") as SongSource,
      chordpro,
      chartFormat,
      attachments,
      defaultView,
      notes,
      annotations: existing?.annotations ?? {},
    };
```

- [ ] **Step 4: Render the picker**

The metadata rows inside `tab === "source"` currently continue from the Artist/Tempo/Time-Sig row straight into the Import/format-toggle row:

```tsx
          <div style={{ display: "flex", gap: 7 }}>
            <div className="field" style={{ flex: 2 }}>
              <label>Artist</label>
              <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist or Traditional" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Tempo</label>
              <input value={tempo} onChange={(e) => setTempo(e.target.value)} placeholder="BPM" inputMode="numeric" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Time Sig.</label>
              <input value={timeSig} onChange={(e) => setTimeSig(e.target.value)} placeholder="4/4" />
            </div>
          </div>

          <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
            <button className="btn" style={{ flex: 1, height: 34 }} onClick={() => setImportMethodOpen(true)}>
```

Insert the picker between those two blocks — only when there's at least one non-automatic option to offer (matching how other conditional controls in this screen behave):

```tsx
          <div style={{ display: "flex", gap: 7 }}>
            <div className="field" style={{ flex: 2 }}>
              <label>Artist</label>
              <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist or Traditional" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Tempo</label>
              <input value={tempo} onChange={(e) => setTempo(e.target.value)} placeholder="BPM" inputMode="numeric" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Time Sig.</label>
              <input value={timeSig} onChange={(e) => setTimeSig(e.target.value)} placeholder="4/4" />
            </div>
          </div>

          {(chordpro.trim() || CATEGORY_PRIORITY.some((k) => attachments[k])) && (
            <div className="field">
              <label>Default on Live Stage</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                <button
                  type="button"
                  className={"chip" + (!defaultView ? " active" : "")}
                  onClick={() => setDefaultView(undefined)}
                >
                  Automatic
                </button>
                {chordpro.trim() && (
                  <button
                    type="button"
                    className={"chip" + (defaultView === "chords" ? " active" : "")}
                    onClick={() => setDefaultView("chords")}
                  >
                    Chords/Lyrics
                  </button>
                )}
                {CATEGORY_PRIORITY.filter((k) => attachments[k]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={"chip" + (defaultView === k ? " active" : "")}
                    onClick={() => setDefaultView(k)}
                  >
                    {ATTACHMENT_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
            <button className="btn" style={{ flex: 1, height: 34 }} onClick={() => setImportMethodOpen(true)}>
```

- [ ] **Step 5: Verify**

Run: `npm run build` — expect clean.
Run: `npm run dev`.
  1. Open a song with chords and no attachments for editing — confirm the picker shows "Automatic" and "Chords/Lyrics" only.
  2. Open a song with chords and one PDF attached — confirm the picker also lists "PDF". Pick "PDF", Save, then reopen the same song for editing — confirm "PDF" is still selected (persisted round-trip).
  3. Create a brand-new song with no chords typed and no attachments yet — confirm the picker doesn't render at all until you add chords or attach something.
  4. Pick a non-"Automatic" option, then discard (Cancel → "Discard changes") — confirm the change wasn't saved (reopen the song, still "Automatic").

- [ ] **Step 6: Commit**

```bash
git add src/screens/add-edit-song/AddEditSong.tsx
git commit -m "Add a Default-on-Live-Stage picker to Add/Edit Song"
```

---

### Task 8: Make Live Stage honor the saved default view

**Files:**
- Modify: `src/state/store.ts`
- Modify: `src/screens/live-stage/LiveStage.tsx`

**Interfaces:**
- Consumes: `Song.defaultView` (Task 1, now settable via Task 7's UI).
- Produces: `resolveDefaultView(song)` replaces the module-private `defaultView(song)` in `store.ts` (renamed to avoid reading as a collision with the `Song.defaultView` *field* it now consults).

- [ ] **Step 1: Rename and extend `store.ts`'s view-resolution function**

Currently:

```ts
/** A song with no chords/lyrics text but at least one attachment should
 * open on the attachment view, not an empty chart. */
function defaultView(song: Song | undefined): StageState["view"] {
  if (song && !song.chordpro.trim() && Object.keys(song.attachments).length > 0) return "sheet";
  return "chords";
}
```

Change to:

```ts
/** A song's Live Stage view: honors a saved `song.defaultView` when it
 * still applies to this song (its chords weren't cleared out, or its
 * chosen attachment kind is still attached); otherwise falls back to the
 * automatic guess — chords if the song has any, else its first available
 * attachment, matching the behavior before per-song defaults existed. */
function resolveDefaultView(song: Song | undefined): StageState["view"] {
  if (!song) return "chords";
  if (song.defaultView === "chords" && song.chordpro.trim()) return "chords";
  if (song.defaultView && song.defaultView !== "chords" && song.attachments[song.defaultView]) return "sheet";
  if (!song.chordpro.trim() && Object.keys(song.attachments).length > 0) return "sheet";
  return "chords";
}
```

- [ ] **Step 2: Update every call site**

There are three call sites in `src/state/store.ts`, all currently calling `defaultView(...)`.

In `makeEmptyStage`:

```ts
    view: defaultView(defaultSong),
```

becomes:

```ts
    view: resolveDefaultView(defaultSong),
```

In the `STAGE_LOAD` case:

```ts
          view: defaultView(song),
        },
      };
    }
```

becomes:

```ts
          view: resolveDefaultView(song),
        },
      };
    }
```

In the `STAGE_ADVANCE` case — after Task 3's edit this is a single-line object literal, not its own line, so match it precisely:

```ts
        stage: { ...state.stage, songId: nextId, setlistIndex: nextIndex, dispKey, view: defaultView(song) },
```

becomes:

```ts
        stage: { ...state.stage, songId: nextId, setlistIndex: nextIndex, dispKey, view: resolveDefaultView(song) },
```

- [ ] **Step 3: Make `LiveStage.tsx`'s attachment-kind seeding consult `defaultView` too**

`resolveDefaultView` above only decides chords vs. sheet at the `StageState["view"]` level. Once in sheet view, *which* attachment kind opens is still decided separately in `LiveStage.tsx`, by the effect that seeds `activeKind`/`activeVersionId` whenever the song changes. Currently:

```ts
  // Which category/version is on screen belongs to the song currently on
  // stage — reset to that song's default (highest-priority category, its
  // bucket's default version) whenever the song changes.
  useEffect(() => {
    const attachments = song?.attachments ?? {};
    const kind = firstAvailableCategory(attachments);
    setActiveKind(kind);
    setActiveVersionId(kind ? selectedVersion(attachments[kind]!).id : undefined);
  }, [song?.id]);
```

Change to:

```ts
  // Which category/version is on screen belongs to the song currently on
  // stage — reset to that song's saved default kind if it has one and it's
  // still attached, else the highest-priority available category, then that
  // bucket's own default version, whenever the song changes.
  useEffect(() => {
    const attachments = song?.attachments ?? {};
    const savedKind = song?.defaultView && song.defaultView !== "chords" ? song.defaultView : undefined;
    const kind = savedKind && attachments[savedKind] ? savedKind : firstAvailableCategory(attachments);
    setActiveKind(kind);
    setActiveVersionId(kind ? selectedVersion(attachments[kind]!).id : undefined);
  }, [song?.id]);
```

- [ ] **Step 4: Verify**

Run: `npm run build` — expect clean.
Run: `npm run dev`.
  1. In Add/Edit Song, set a song's default to a specific attachment kind (e.g. PDF) and save.
  2. From Library, load that song onto Live Stage (tap its row, or however it's normally opened) — confirm it opens directly to the PDF view, not the automatic guess.
  3. Edit the same song, set its default back to "Automatic", save, reload it onto Live Stage — confirm it's back to today's automatic behavior (chords if it has any).
  4. Edit a song, set its default to an attachment kind, then remove that attachment entirely (via that kind's tab → "Remove this version" until the bucket is empty) and save. Load it onto Live Stage — confirm it falls back to the automatic guess instead of failing to open a view that no longer exists.
  5. Load any song that never had a default set — confirm behavior is identical to before this task.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts src/screens/live-stage/LiveStage.tsx
git commit -m "Make Live Stage open a song to its saved default view instead of always guessing"
```

---

## Self-Review Notes

- **Spec coverage:** all seven numbered items in the spec's Context map to a task — badge (Task 2), no-op end-of-set (Task 3), toolbar/selector consolidation (Task 5), theme scope (Task 4), iPad Air viewports (Task 6), and persisted default view (Tasks 1, 7, 8). The spec's "Automatic" clearing option (added during spec self-review) is implemented in Task 7 Step 4.
- **Placeholder scan:** no TBD/TODO; every step carries the literal before/after code, not a description of it.
- **Type consistency:** `StageToolsSheet`'s prop names (`onSelectChords`, `onSelectSheet`, `activeKind`, `activeVersionId`, `availableKinds`) match exactly what Task 5 Step 4 passes from `LiveStage.tsx`. `MusicToolbar`'s new two-prop signature (`transposeLocked`, `onOpenTools`) matches its Task 5 Step 4 call site. `Song["defaultView"]` (Task 1) matches its consumers in Tasks 7 and 8 (`"chords" | AttachmentKind | undefined`, never widened to plain `string`).
- **Ordering:** Task 5 depends on Task 3 already having removed the `ended`/`STAGE_REPLAY` branch (it edits code right below where that branch used to be) and stands independently of Tasks 1/6/7/8. Task 8 depends on Task 1 (the field must exist) and reads more naturally after Task 7 (so there's a UI to set the field before wiring up what reads it), but could technically run right after Task 1 if preferred — no task after Task 1 breaks if reordered this way.
