# Zamar OMR service

A standalone backend that turns sheet music (MusicXML, or a PDF/photo scan)
into a ChordPro chart. It's what `src/services/omr/httpOmrProvider.ts` in the
main app talks to when `VITE_OMR_API_URL` is set; without that env var the
app falls back to an in-memory simulation (`mockOmrProvider.ts`) so it still
runs standalone.

## What's real here, and what isn't

- **MusicXML/.mxl → ChordPro is fully real.** `src/musicxml/parseMusicXml.ts`
  walks the score in true document order (chord symbols, lyrics, key
  signature, tempo) and `toChordPro.ts` derives an actual chart from it —
  chord placement comes from each note's real beat position, not a fixed
  sample. This needs no machine learning; it's genuine parsing of structured
  data that notation software already exports correctly.
- **PDF/photo → MusicXML is not wired to a real recognizer yet.** That step
  is optical music recognition (OMR) — recovering notation from pixels —
  which requires a trained model, not application code. `src/engine/
  omrEngine.ts` defines the `OmrEngine` interface and an `AudiverisOmrEngine`
  that shells out to a locally-installed [Audiveris](https://github.com/
  Audiveris/audiveris) CLI (chosen because it exports `.mxl` directly). It
  fails with a clear "not configured" error instead of fabricating chords, so
  the pipeline stays honest about what it can do. Wiring it up needs:
  1. A Java runtime and the Audiveris jar installed on the host.
  2. `AUDIVERIS_JAR_PATH` pointed at it.
  3. Filling in the `execFile`/temp-file plumbing sketched in the TODO in
     that file (untested here — Audiveris bundles ~300MB of trained models
     that can't be installed in this environment).

  Swapping in a different engine (oemer, a commercial API, etc.) means
  implementing `OmrEngine.recognize()` and returning `getOmrEngine()`
  accordingly — nothing else in the pipeline needs to change.

## API

- `POST /v1/omr/jobs` — multipart form with `file` (the upload) and `kind`
  (`"pdf" | "photo" | "musicxml"`). Returns `{ jobId }` immediately; the job
  processes asynchronously.
- `GET /v1/omr/jobs/:id` — returns the job:
  ```ts
  {
    id: string;
    status: "queued" | "processing" | "done" | "error";
    step: number;
    stepLabels: string[]; // for a progress UI
    result?: { chordpro, chartFormat: "chordpro", detectedKey?, detectedTempo?, musicXml?, warnings? };
    error?: string;
  }
  ```
- `GET /v1/omr/jobs/:id/mxl` — downloads the job's raw MusicXML once done.

Jobs are stored in memory (`src/jobStore.ts`) — fine for a single-process
dev/demo setup; a real deployment should back this with a queue/database so
jobs survive restarts and can be picked up by multiple workers.

## Running it

```
npm install
cp .env.example .env   # set AUDIVERIS_JAR_PATH once you have a real engine
npm run dev             # http://localhost:8787
```

Then point the app at it: in the repo root, set `VITE_OMR_API_URL=http://localhost:8787` (e.g. in a `.env.local`) before `npm run dev`.
