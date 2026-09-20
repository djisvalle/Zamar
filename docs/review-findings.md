# Zamar — Senior Review Findings

Date: 2026-09-12
Branch reviewed: `mockup-to-implementation`
Scope: full codebase (architecture, persistence, navigation) + UI/UX design review, benchmarked against modern iOS conventions.

Context: this branch has moved from an in-memory "mockup" (as [CLAUDE.md](../CLAUDE.md) still describes it) to a real Capacitor + SQLite app, but the docs, some feature copy, and some Settings toggles hadn't caught up at review time. That mismatch is the throughline in most findings below.

---

## 🔴 High severity

1. **Fake sheet-music placeholder for every song without a real attachment.** `ScorePreview.tsx` is a single hardcoded SVG staff (fixed note coordinates, unrelated to any actual song) shown on the "Sheet" tab for all 10 seeded songs, captioned "Rendered MusicXML score" as if it were real notation. Identical picture regardless of song, key, or transpose — actively misleading in a demo.
   *(Addressed later in the session — this became the basis for the real MusicXML-derived `MxlScore` renderer.)*

2. **Two dead Settings toggles.** "Autoscroll on load" and "Keep screen awake" persist a boolean but nothing reads either flag anywhere in the app — no scroll timer, no Wake Lock/KeepAwake call. "Scroll hands-free" is literally in the onboarding splash copy; the app promises this in its own marketing copy and exposes a switch for it, and it does nothing.

3. **"Stage Dark" setting's own description is false.** Settings shows *"Stage Dark — Dark chart on stage, light everywhere else"*, but `App.tsx` applies `data-theme` to the whole `.device` root — toggling it darkens the entire app, not just the chart. Matches CLAUDE.md's admitted simplification, but the in-app copy still advertises the scoped behavior that was cut.

4. **Settings' text-size slider doesn't control the screen it claims to.** `Appearance.tsx` says *"the sample matches the performance view exactly,"* driven by `settings.textScale`. But `LiveStage.tsx` feeds `ChordChart` from a separate, session-only `stage.zoom` (the on-stage Zoom +/− buttons). Two same-range (70–160%) controls for the same thing, don't compose, and the on-stage one resets to 100% every session since stage state isn't persisted.

5. **Persistence boot sequence has a real corruption path.** `main.tsx` treats `settingsRepo.loadAll() === null` as the sole "first run" signal, but settings is written in a *separate* step after songs/setlists (`store.ts`). If the process dies between those two writes, next boot sees `settings === null`, reseeds sample data, and the debounced persist effect silently overwrites real on-disk data. `main.tsx`'s catch-all also swallows any DB open/migration failure to `console.warn` and falls back to reseeding — recoverable corruption becomes silent data loss. This is a "fix round 1–4" area per commit history; the fixes patched symptoms without solving the underlying gate/atomicity problem.

6. **iOS build was broken.** Uncommitted `ios/App/CapApp-SPM/Package.swift` added a SQLite package path using Windows backslashes inside a Swift string literal — invalid escape sequences that fail to parse in Xcode. SPM paths need POSIX forward slashes regardless of the generating OS.

## 🟠 Medium severity

7. **Setlist "Upcoming/Past" is a static label, not derived from the date.** `mockData.ts` hardcodes `status: "upcoming"` independent of the `date` string; nothing recomputes it. Seeded setlists dated Aug 2026 still showed under "Upcoming" when reviewed in September 2026.

8. **Floating action buttons can block the last list rows.** Library's scrollable list has no bottom padding reserved for `.fab-stack`; the last 1–2 rows (and their "⋯" menu button) sit under the FABs with no way to reach them without a real user's scroll assist masking the issue.

9. **Icon/glyph reuse was ambiguous.** The same pencil glyph meant "quick-edit metadata" (mini FAB) in one place and "annotate the chart" (toolbar) in another.
   *(Fixed — see icon-set work below.)*

10. **Creating a setlist writes to the store immediately**, before the user enters any details, with no cancel/discard path — inconsistent with Add/Edit Song, which never dispatches until Save.

## 🟡 Low severity / polish

- Stale comment in `types.ts`: `dataUrl` still documented as "in-memory only, like everything else in this mockup" — no longer true once SQLite persistence landed.
- CLAUDE.md itself is stale on "Single global reducer, no persistence."
- `chordpro.ts`'s `normalizeRoot` only maps 5 flats; an uncommon root silently no-ops instead of erroring.
- `setlistCalc.ts` treats a missing AM/PM suffix as AM with no validation.
- Heavy use of ad-hoc inline `style={{...}}` objects instead of shared CSS classes.

---

## Pure UI/UX design review (vs. modern iOS conventions)

Context given for this pass: users are coming from OnSong on iOS; Zamar's differentiator is sheet-music flexibility.

- **Icons were raw Unicode glyphs** (☰ ♪ ▤ 〰 ⚙ ✎ ⇩ ⌕ ‹ › ⋯), not a real icon set — inconsistent stroke weight/optical size, risk of emoji-fallback rendering on some platforms. **Fixed**: built a small hand-drawn SVG icon set (`Icon.tsx`, Feather-style, matched stroke weight) and swapped it in everywhere.
- **Toggle switch knob changed color between on/off states** (`var(--fg)` when on), reading as a stray black dot in light mode instead of a fixed neutral knob like a real iOS switch. **Fixed**: added a dedicated `--knob` token, always neutral regardless of state.
- **FABs are a Material Design pattern**, not native to iOS (which uses nav-bar/toolbar buttons instead of floating circles). Noted as a stylistic departure from "looks like an iOS app" — not changed, since removing FABs entirely is a bigger layout change than was in scope.
- **No translucency/blur anywhere** — sheets/dialogs/drawers sat on a flat opaque scrim instead of the frosted-glass materials iOS uses pervasively. **Fixed**: added `backdrop-filter: blur()` to the shared backdrop and softened the overlay shadows.
- Typography (Barlow/Barlow Condensed/Bebas Neue) is a deliberate, coherent brand choice — not a defect, just not stock iOS system font. Text sizes generally run a little small relative to iOS defaults (17pt body vs. ~13–15px here), including the chord/lyric chart itself, which is a legibility concern for a "read it from a music stand" use case.
- List rows use a "boxed card per row" style (Material-ish) rather than iOS's fused grouped-table look — a valid alternative style, just not the native one.
- No iOS-style Large Title on root screens (Library/Setlists/Settings all use the same small inline header).

## Also addressed this session (beyond the original review)

- Removed the sample-library onboarding choice ("Load the samples" / "Start empty") — a fresh install now seeds exactly one song and boots straight to Live Stage.
- Replaced the fake, identical-for-every-song `ScorePreview` graphic with `components/MxlScore.tsx`, which renders the song's actual attached score via OpenSheetMusicDisplay (see below for how this evolved).
- Added real pinch-to-zoom + drag-to-pan on the score itself.

## Sheet-music rendering: the real resolution

The hand-rolled approach (custom layout math + real Bravura/SMuFL font glyphs) went through several rounds of fixes — clef/note overlap from underestimating real glyph width, a plain line standing in for the grand-staff brace, faint UI-hairline color used for staff lines — and still didn't reach real engraving quality. The user then showed reference screenshots of a prior/other app's `.mxl` viewer (full multi-instrument orchestral layout, multi-measure rests, correct accidentals, proper spacing) as the actual bar.

That's the point where continuing to patch a hand-rolled renderer stopped being the right call: matching a dedicated notation engine's output by hand-building layout and glyph placement is fighting the wrong battle. **Replaced the entire custom renderer with [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/)** (OSMD, BSD-licensed, built on VexFlow) — it loads the `.mxl` URL directly (own unzip/parse, no custom `musicxml.ts` needed) and lays out real engraving (clefs, beams, ties, multi-rests, accidentals, key signatures) the way real notation software does, because it *is* the same class of tool. Deleted the custom `utils/musicxml.ts` parser and the Bravura font assets — no longer needed once OSMD owns rendering.

Kept from the earlier attempt: the pinch-to-zoom/drag-to-pan wrapper (`usePinchZoom`), which works identically regardless of what's rendered inside it — reused as-is around OSMD's output. OSMD is lazy-loaded (dynamic `import()`) since it's a ~350KB-gzipped chunk only needed on screens that actually show a MusicXML attachment; it doesn't affect the main app bundle.

One real bug hit and fixed along the way: OSMD's container was `display: none` while the score loaded, so OSMD measured a zero-width box mid-layout (visible as `SkyBottomLineCalculator: width not > 0` console warnings for every measure). Fixed by hiding it via `visibility: hidden` instead, which keeps real layout dimensions intact while invisible.
