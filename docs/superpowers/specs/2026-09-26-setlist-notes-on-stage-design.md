# Setlist slot notes on Live Stage

## Context

A setlist slot's "Note for the band" (`SetlistItem.note`, edited in `SlotDetailSheet.tsx`)
only showed on the setlist run sheet (`SetlistDetail.tsx`). Live Stage never read it, so the
note wasn't on screen during the set, which is when the band needs it. The per-song Cues
(`Song.notes`) are a separate thing: they belong to the song in every set, and are still
shown only in Annotate's Cues mode.

Design decisions confirmed with the user in chat:

- **This slot's note goes under the progress bar** in Live Stage's setlist strip.
- **The "Next:" line previews the next slot's note**: `Next: <title> · <note>`.
- Both show only when the song was loaded from a setlist, and only when the slot has a note.

## Behavior

- **Slot note.** One line under the progress bar, in the run sheet's `.row-note` style (the
  same pencil icon, `--acc-deep`). A note too long for the line gets an ellipsis. Tapping it
  expands the full text (line breaks kept), and tapping again collapses it. It resets to
  collapsed whenever the slot changes. A tap on it counts as a control tap, so it wakes the
  chrome and never toggles it.
- **Next-slot preview.** The next note follows the title in italics on the existing one-line
  "Next:" row. The row gets an ellipsis if it overflows, so the title comes first and is what
  survives. "Last song" is unchanged.
- **Always visible, not part of the idle auto-hide.** The strip it sits in doesn't hide with
  the chrome today. Hiding just the note would shift the chart every 6s, which is worse on
  stage than one steady line. (This differs from the first chat proposal, which had it hiding
  with the chrome.)
- **Slots, not songs.** Notes come from the slot at `stage.setlistIndex`, so a reprise shows
  its own slot's note. `activeSetlistSlots` (`store.ts`) returns the song slots in the same
  order as `activeSetlistSongIds`, so one index works for both.

## Out of scope

- **Note-only setlist rows** (e.g. "Welcome & announcements") are still skipped by stage
  navigation. Showing them as their own stage pages is a possible follow-up.
- **Song Cues on stage** outside Annotate.
