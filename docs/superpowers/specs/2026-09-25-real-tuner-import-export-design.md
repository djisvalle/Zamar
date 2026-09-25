# Real tuner, chart import and export

Replaces the three features the app used to simulate. Everything runs on device and
offline.

## Tuner

- `getUserMedia` (echo cancellation, noise suppression and AGC off) into a Web Audio
  `AnalyserNode` (4096-sample buffer), analysed every 50 ms.
- McLeod Pitch Method (`src/utils/pitch.ts`), with the buffer halved at 44.1/48 kHz for
  speed, an RMS silence gate and a clarity floor. A 5-reading median steadies the needle;
  it resets when the note jumps by more than a semitone.
- Chromatic mode measures against the nearest equal-tempered note (A4 = 440). Instrument
  presets default to **Auto** (nearest string); tapping a string locks to it.
- In tune is within ±5 cents. The needle spans ±50 cents.
- The existing pre-prompt stays. "Allow" opens the mic, which triggers the OS prompt. A
  denied or missing mic shows its own state with the platform's settings path.
- The stream stops when the Tuner unmounts (switching tabs) or the app is backgrounded.
- Native: `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` (Android), `NSMicrophoneUsageDescription`
  (iOS). No plugin; Capacitor's web views forward the permission request.

## "Chords & lyrics" import

`src/utils/chartImport.ts`:

1. **PDF with a text layer:** pdf.js `getTextContent`. Each text run is split into words
   placed by their share of the run's width.
2. **Photo, or a PDF with under 20 characters of text (a scan):** Tesseract.js OCR. The
   engine (`tesseract-core-lstm.wasm.js`, non-SIMD so it runs everywhere) and the English
   `best_int` model are bundled, which adds about 7 MB. Photos go through an `<img>` first,
   so EXIF rotation applies, and are downscaled to 2400 px. Tesseract drops or garbles lone
   chord letters, so every row that already looks like a chord row is re-read on its own
   (single-line mode, chord-only character whitelist).
3. **Layout:** words are grouped into rows and placed on a monospace grid (median character
   width). Tight gaps become one space. A row gap over 1.6× the usual line pitch becomes a
   stanza break. The existing chords-over-lyrics parser then pairs chord and lyric lines.
4. **Clean-up (`textToChart`):** `[Verse 1]` becomes a section label, "Page n of m" lines
   are dropped, and the header above the first chord line or section fills in title,
   artist, key, tempo and time signature. When no key is given, the key falls back to the
   first chord's root (keys are roots only in the app).

Sheet-vs-chords is still declared by the user. When nothing readable is found, the error
screen offers Try again, keeping the file as a PDF or photo, or choosing another file.

## Export

`src/utils/exportSet.ts`. Per song, `planExport` picks what goes in:

| Format | Per song | Skipped when |
|---|---|---|
| PDF | the same view Live Stage opens: saved default, else chart, else first attachment | no chart and no attachment |
| ChordPro | the chart | no chart |
| MusicXML | the selected MusicXML version | no MusicXML attachment |

- **PDF (pdf-lib):** uses the standard Helvetica fonts, with characters outside WinAnsi
  replaced by `?`. Chords are drawn in the accent blue over lyric columns measured in the
  lyric font, and long lines wrap at words, carrying their chords with them. "One song per
  page" is optional. PDF attachments are copied in page by page, photos get a page each,
  and scores are engraved by OSMD in the slot's key (paged, rasterized at 2400 px). Score
  pages use narrower side margins than chart text (30 pt), OSMD's own page margins are kept
  small, notation is engraved at 1.2× with tighter system spacing, and blank space below the
  last system is trimmed.
  "Note names on noteheads" (PDF only, shown when the set has scores) replaces each notehead
  with Bravura's SMuFL note-name notehead for the transposed pitch (black, half or whole
  shape by duration), the same glyphs MuseScore's note-name scheme uses. Bravura is embedded
  in each page's SVG as a data URL, since an SVG loaded as an image can't reach page fonts. The
  footer shows the set name and page number. Paper is Letter in US/CA/MX/PH and a few other
  Letter locales, and A4 elsewhere.
- **ChordPro:** metadata directives first, then the chart re-serialized to bracket
  notation in the slot key (chords-over-lyrics charts are converted). Sections become
  `{comment: …}`. Songs are joined with `{new_song}`.
- **MusicXML:** scores are exported as imported, one file or a zip (fflate). A score
  can't be re-keyed inside the file, so the done sheet names any song whose set key
  differs.
- **Sharing (`src/utils/shareFile.ts`):** native writes to the cache directory and opens
  `@capacitor/share` (Save to Files, Mail, AirDrop and Print are all in the sheet). The
  browser uses Web Share with files when available, else a download.

Not included: annotations, cues/notes, and setlist note items.

## Untested

Nothing here has run on a device yet. The iOS mic (a web-view permission prompt may appear
on top of the OS prompt), the Android web-view mic permission, OCR speed on phones, and the
native share sheet all need a device check.
