# Zamar

**Make worship, made easier.**

Zamar is an offline, on-device chord chart and setlist app for worship teams. It keeps a
band's songs, charts, sheet music and set plans on the phone or tablet itself, and puts
them on a distraction-free stage view during a service. It works with no network and no
account, and nothing leaves the device unless you export it.

It is built first for musicians moving over from OnSong on iOS, so it follows iPhone and
iPad conventions. It is a cross-platform Capacitor app, though, and runs on Android and in
the browser too.

## Why

Worship musicians juggle chord charts, lead sheets, PDFs from publishers and photos of
hand-marked pages, often in a different key every week and with notes for the band that
change from service to service. Zamar puts all of that in one place:

- **Any chart, any key.** ChordPro and chords-over-lyrics charts are parsed and transposed
  properly, with the right sharp or flat spelling for the key. MusicXML sheet music is
  re-engraved in the new key, not just relabelled.
- **Sheet music as well as chords.** A song can carry MusicXML scores, PDFs and photos
  alongside its chord chart, each with several versions.
- **Mark it up like paper.** Draw, highlight, add sticky notes, text, notation symbols and
  shapes on any chart. Marks stay put when the key changes or the device rotates.
- **Run the set.** Build setlists with sections, start times and per-slot key and note
  overrides, then swipe through them on stage with the next song and the band's notes
  in view.

## Features

- **Live Stage.** Full-screen chart view with key chips, a Stage Tools sheet, chrome that
  hides itself, song-to-song swipes through a set, next-song preview, progress bar and
  slot notes.
- **Library.** A–Z song list with search, filters, multi-select delete and a per-song
  action sheet.
- **Setlists.** Upcoming, past and template sets; a run sheet with sections, derived start
  times, drag-to-reorder songs and sections, and per-slot key and note overrides.
- **Song editor.** One screen for new and existing songs, with ChordPro or
  chords-over-lyrics editing, quick-insert chips, caret keys, undo/redo, a chart-problem
  banner, a live preview, and ChordPro directives kept in sync with the song's fields.
- **Import.** PDF, photo and MusicXML files, kept as sheet music or converted to an
  editable chord chart (PDF text layer, or offline OCR for photos and scans).
- **Annotate.** Pen, highlighter, sticky notes, text, 59 engraved notation symbols, shapes,
  eraser, multi-select and undo, drawn over chord charts, PDFs, photos and scores.
- **Export.** PDF (with annotations if you want them), ChordPro and MusicXML re-keyed to
  the set key, for a whole set or a single song, shared through the system share sheet.
- **Tuner.** Microphone pitch detection with chromatic, guitar, bass, ukulele, violin,
  viola and cello presets.
- **Settings.** Light and Stage Dark appearance, text size, stave spacing and key-spelling
  options.

All data is stored in SQLite on the device.

## Tech stack

Vite, React 18 and TypeScript, wrapped in Capacitor for iOS and Android.
`@capacitor-community/sqlite` stores data on device (`sql.js` + `jeep-sqlite` in the
browser). OpenSheetMusicDisplay renders scores, pdf.js renders PDFs, Tesseract.js does
offline OCR, and pdf-lib and fflate build exports. Styling is plain CSS with custom
properties.

## Getting started

```
npm install
npm run dev          # browser dev, inside a phone/tablet device frame
npm run build        # type-check and production build
npm run cap:android  # build, sync and run on Android
npm run cap:ios      # build, sync and run on iOS
```

The Android build has been built and run on devices. The iOS project is scaffolded but not
yet verified in Xcode.

## Documentation

- [`docs/device-testing.md`](docs/device-testing.md): device setup, signed Android release
  builds, debugging and an on-device test checklist.
- [`docs/progress-checklist.md`](docs/progress-checklist.md): feature-by-feature status and
  what is still open.
- [`docs/superpowers/specs/`](docs/superpowers/specs/): design specs for major features.
- [`CLAUDE.md`](CLAUDE.md): architecture notes, conventions and gotchas for contributors.
