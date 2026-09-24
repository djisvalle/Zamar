# Zamar — Senior Review Findings

Originally reviewed: 2026-09-12 (branch `mockup-to-implementation`)
Last re-checked against `main`: 2026-09-24

Scope: full codebase (architecture, persistence, navigation) + UI/UX design review, benchmarked against modern iOS conventions.

This list only carries what is still open or only partly fixed. Findings that are fully done on `main` have been removed; git history has the original list and the notes on how each was resolved. Items tagged **(Partial)** say what was fixed and what is left.

---

## 🟠 Medium priority

1. **(Partial) Persistence fallback runs in-memory with no warning to the person.**
   *Fixed:* the first-run gate and write atomicity. `main.tsx` no longer reseeds just because the settings row is missing (it only treats the boot as first-run when songs and setlists are also empty), and `store.ts` writes songs, setlists and settings in one `executeSet` transaction. A DB open/migration failure now turns persistence off (`persistEnabled: false`) instead of overwriting on-disk data with seed data.
   *Still open:* when that fallback happens, the only signal is a `console.warn`. The app looks normal, the person keeps editing, and every change from that session is lost on the next launch. Add a visible banner or dialog (for example "Storage unavailable, changes won't be saved") whenever `persistEnabled` is false.

2. **(Partial) Settings' text size and the on-stage zoom still don't fully compose.**
   *Fixed:* `makeEmptyStage` now seeds `stage.zoom` from `settings.textScale`, so the Appearance slider does set the size a chart opens at.
   *Still open:* `SET_TEXT_SCALE` only updates `settings`, so moving the slider mid-session doesn't change the chart until the stage resets (exiting a setlist, a fresh launch). The other way round, the on-stage Zoom +/− (`StageToolsSheet.tsx`, `STAGE_SET_ZOOM`) is session-only and never saved. Appearance still says *"the sample matches the performance view exactly,"* which is only true until someone uses the on-stage buttons. Pick one model: either the stage buttons write back to `textScale`, or the copy says the slider sets the starting size. (Zoom code is being changed in a parallel thread; re-check this after it lands.)

## 🟡 Low priority / polish

3. **Heavy use of ad-hoc inline `style={{...}}` objects** instead of shared CSS classes (about 385 across `src/`). This makes theming and spacing changes harder than they need to be.

4. **(Partial) `chordpro.ts` still silently ignores roots it doesn't know.**
   *Fixed:* `FLAT_TO_SHARP` now covers all seven flats (`Cb`…`Bb`).
   *Still open:* anything else it can't map (for example `E#`, `B#`, or a typo) makes `keySemitoneShift` return 0 and `transposeChord` leave the chord as-is, with no error or warning.

---

## UI/UX design notes (vs. modern iOS conventions)

Context for this pass: users are coming from OnSong on iOS; Zamar's differentiator is sheet-music flexibility. These are stylistic departures rather than bugs, listed in rough order of impact.

5. **(Partial) Text sizes run small relative to iOS defaults.**
   *Fixed:* the chord chart itself now renders at 17px lyrics / 14px chords at 100% (`ChordChart.tsx`), in line with iOS body text.
   *Still open:* much of the surrounding UI copy is still 10–13px (about 57 inline `fontSize: 10`/`11` uses, plus 10–13px rules in `theme.css`), below iOS's ~13–17pt range.

6. **FABs are a Material Design pattern**, not native to iOS (which uses nav-bar/toolbar buttons). Library still uses `.fab-stack`. Not changed so far because removing FABs is a larger layout change.

7. **List rows use a "boxed card per row" style** (`.list-row` has its own border and radius) rather than iOS's fused grouped-table look. A valid alternative style, just not the native one.
