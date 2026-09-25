# Zamar — Senior Review Findings

Originally reviewed: 2026-09-12 (branch `mockup-to-implementation`)
Last re-checked against `main`: 2026-09-25

Scope: full codebase (architecture, persistence, navigation) + UI/UX design review, benchmarked against modern iOS conventions.

This list only carries what is still open or only partly fixed. Findings that are fully done on `main` have been removed; git history has the original list and the notes on how each was resolved. Items tagged **(Partial)** say what was fixed and what is left.

---

## 🟡 Low priority / polish

1. **Heavy use of ad-hoc inline `style={{...}}` objects** instead of shared CSS classes (about 235 left across `src/`). This makes theming and spacing changes harder than they need to be.

---

## UI/UX design notes (vs. modern iOS conventions)

Context for this pass: users are coming from OnSong on iOS; Zamar's differentiator is sheet-music flexibility. These are stylistic departures rather than bugs.

2. **(Partial) Text sizes run small relative to iOS defaults.**
   *Fixed:* the chord chart itself now renders at 17px lyrics / 14px chords at 100% (`ChordChart.tsx`), in line with iOS body text, and the iOS look rollout moved lists, controls and forms to iOS sizes.
   *Still open:* some surrounding UI copy is still set inline at 10–13px, below iOS's ~13–17pt range.
