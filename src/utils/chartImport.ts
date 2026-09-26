import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import ocrWorkerUrl from "tesseract.js/dist/worker.min.js?url";
import ocrCoreUrl from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import ocrEngUrl from "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url";
import type { ChartFormat } from "../state/types";
import { isChordLine } from "./chordpro";

/** Turns a chart the person picked (a PDF or a photo) into editable chart
 * text. PDFs that carry a text layer (anything exported from a word
 * processor, OnSong, PraiseCharts, …) are read directly with pdf.js; photos
 * and scanned PDFs with no text go through on-device OCR (Tesseract, whose
 * engine and English model are bundled, so it works offline). Either way the
 * words' page positions are laid back out on a monospace grid, which keeps a
 * chord line's chords over the right syllables closely enough for the
 * existing chords-over-lyrics parser to pair them up. */

export interface ConvertedChart {
  chordpro: string;
  chartFormat: ChartFormat;
  title?: string;
  artist?: string;
  key?: string;
  tempo?: number;
  timeSig?: string;
  /** True when the text came from OCR — the review screen says to check it. */
  fromOcr: boolean;
}

export class NoChartTextError extends Error {
  constructor() {
    super("No chords or lyrics were found in this file.");
  }
}

export type ConvertProgress = (step: string, fraction: number) => void;

/** One run of text with its box on the page, in any unit as long as y grows
 * downward and all items share it. */
interface PositionedText {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

interface Row {
  yc: number;
  items: PositionedText[];
}

/** Groups words into rows by vertical centre. Rows whose boxes then mostly
 * overlap are one line split up — OCR can return a garbled chord line as
 * slivers of its letters' tops next to whole letters, whose centres sit
 * too far apart to group — and are joined. */
function groupRows(items: PositionedText[]): Row[] {
  const words = items.filter((it) => it.text.trim() && it.w > 0 && it.h > 0);
  const lineH = median(words.map((it) => it.h)) || 1;
  const rows: Row[] = [];
  for (const it of [...words].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const yc = it.y + it.h / 2;
    const row = rows[rows.length - 1];
    if (row && Math.abs(yc - row.yc) < lineH * 0.5) row.items.push(it);
    else rows.push({ yc, items: [it] });
  }
  const joined: Row[] = [];
  for (const row of rows) {
    const prev = joined[joined.length - 1];
    if (prev) {
      const a = rowExtent(prev);
      const b = rowExtent(row);
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap > Math.min(a.bottom - a.top, b.bottom - b.top) / 2) {
        prev.items.push(...row.items);
        continue;
      }
    }
    joined.push(row);
  }
  return joined;
}

interface Band {
  top: number;
  bottom: number;
}

function rowExtent(row: Row): Band {
  return {
    top: Math.min(...row.items.map((w) => w.y)),
    bottom: Math.max(...row.items.map((w) => w.y + w.h)),
  };
}

/** Lays rows of positioned words back out as plain text lines: columns by
 * horizontal position divided by the typical character width, and a blank
 * line wherever the gap to the previous row is clearly bigger than the
 * usual line pitch (a stanza break). */
function layoutRows(rows: Row[]): string {
  const words = rows.flatMap((r) => r.items);
  if (!words.length) return "";
  const charW = median(words.map((it) => it.w / it.text.length)) || 1;
  const minX = Math.min(...words.map((it) => it.x));
  const pitches = rows.slice(1).map((r, i) => r.yc - rows[i].yc);
  const pitch = median(pitches) || Infinity;

  const out: string[] = [];
  rows.forEach((row, i) => {
    if (i > 0 && pitches[i - 1] > pitch * 1.6) out.push("");
    let line = "";
    let prevEnd = -Infinity;
    for (const it of [...row.items].sort((a, b) => a.x - b.x)) {
      const col = Math.max(0, Math.round((it.x - minX) / charW));
      const ownCharW = it.w / it.text.length;
      // Words set close together (a big title, normal prose) get one space;
      // only a real gap, like between the chords of a chord line, is
      // carried over as columns.
      if (line.length && it.x - prevEnd < ownCharW * 1.5) line += " ";
      else if (col > line.length) line += " ".repeat(col - line.length);
      else if (line.length) line += " ";
      line += it.text;
      prevEnd = it.x + it.w;
    }
    out.push(line.trimEnd());
  });
  return out.join("\n");
}

function layoutPositionedText(items: PositionedText[]): string {
  return layoutRows(groupRows(items));
}

/** pdf.js hands back runs of text that can hold several words separated by
 * spaces in a proportional font. Splitting each run into words and placing
 * every word by its share of the run's width keeps a spaced-out chord line
 * ("G        D        Em") on the right columns. */
function splitRun(run: PositionedText): PositionedText[] {
  const perChar = run.w / Math.max(1, run.text.length);
  const out: PositionedText[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run.text))) {
    out.push({ x: run.x + m.index * perChar, y: run.y, w: m[0].length * perChar, h: run.h, text: m[0] });
  }
  return out;
}

async function loadPdf(dataUrl: string) {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfjsLib.getDocument({ url: dataUrl });
}

type PdfDoc = Awaited<Awaited<ReturnType<typeof loadPdf>>["promise"]>;

async function pdfTextLayer(doc: PdfDoc, onProgress: ConvertProgress): Promise<string> {
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onProgress(`Reading page ${n} of ${doc.numPages}…`, (n - 1) / doc.numPages);
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const runs: PositionedText[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , , d, e, f] = item.transform as number[];
      const h = item.height || Math.abs(d);
      // PDF y runs up from the page bottom; flip so it grows downward.
      runs.push(...splitRun({ x: e, y: -f - h, w: item.width, h, text: item.str }));
    }
    pages.push(layoutPositionedText(runs));
  }
  return pages.join("\n\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ocrWorkerPromise: Promise<any> | null = null;
let ocrProgress: ConvertProgress | null = null;

/** One Tesseract worker, created on first use and kept for the session —
 * loading the engine and model is the slow part, not recognizing a page. */
async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      // tesseract.js only rejects `createWorker` when the engine fails to
      // load; if the model then fails to load or initialize it reports that
      // to `errorHandler` and leaves the promise pending forever, which left
      // import stuck on "Preparing text recognition…". Race the two so any
      // setup failure surfaces as an error instead.
      let fail!: (err: Error) => void;
      const failed = new Promise<never>((_, reject) => (fail = reject));
      const created = createWorker("eng", 1, {
        workerPath: ocrWorkerUrl,
        corePath: ocrCoreUrl,
        // A blob-URL worker can't importScripts the bundled core from the
        // app's own scheme (capacitor://, https://localhost) in every web
        // view, so the worker script is loaded by URL directly.
        workerBlobURL: false,
        // Tesseract fetches `${langPath}/eng.traineddata[.gz]`, so the
        // bundled model keeps its real file name (see vite.config.ts) and
        // only its folder is passed here. The build ships it without the
        // ".gz" suffix, because Android's asset packaging doesn't reliably
        // serve a ".gz" file under its own name; Tesseract spots the gzip
        // data by its header and unpacks it either way.
        langPath: new URL(ocrEngUrl, location.href).href.replace(/\/[^/]*$/, ""),
        gzip: ocrEngUrl.endsWith(".gz"),
        cacheMethod: "none",
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") ocrProgress?.("Reading text…", m.progress);
        },
        errorHandler: (err: unknown) => fail(new Error(`Text recognition failed: ${String(err)}`)),
      });
      const worker = await Promise.race([created, failed]).catch((err) => {
        created.then((w) => w.terminate()).catch(() => {});
        throw err;
      });
      // "Single column of text of variable sizes": keeps each chord line
      // and lyric line as its own row instead of splitting a sparse chord
      // line into separate blocks. Sauvola (local) thresholding instead of
      // the default global Otsu keeps text on a highlighter-colored band
      // (a yellow "Chorus:") from being dropped as a picture, and copes
      // better with a photo's uneven lighting.
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
        preserve_interword_spaces: "1",
        thresholding_method: SAUVOLA_THRESHOLDING,
      });
      return worker;
    })().catch((err) => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

/** Tesseract's `thresholding_method` values. */
const OTSU_THRESHOLDING = "0";
const SAUVOLA_THRESHOLDING = "2";

/** Characters a chord line can contain — used to re-read chord rows. The
 * space has to be listed too: without it Tesseract runs a whole row into
 * one word ("Bb/F F Dm7 C" → "Bb/FF Dm7C"), which isn't a chord. "|" is a
 * bar line. */
const CHORD_CHARS = "ABCDEFGabdgijmnsu#/0123456789+-()| ";

async function recognizeWords(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  worker: any,
  image: HTMLCanvasElement,
  minConfidence: number
): Promise<PositionedText[]> {
  const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
  const words: PositionedText[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const word of line.words) {
          if (word.confidence < minConfidence || !word.text.trim()) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          words.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, text: word.text.trim() });
        }
      }
    }
  }
  return words;
}

const CROP_MARGIN = 24;

/** Copies part of the image onto its own canvas with a white margin —
 * Tesseract reads an isolated line or word far better with some border. */
function cropRegion(image: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = x1 - x0 + CROP_MARGIN * 2;
  c.height = y1 - y0 + CROP_MARGIN * 2;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(image, x0, y0, x1 - x0, y1 - y0, CROP_MARGIN, CROP_MARGIN, x1 - x0, y1 - y0);
  return c;
}

/** Whether the RGBA pixel at `i` is ink rather than paper. The cut-off sits
 * well above mid-grey so the thin strokes of colored chord text (red is
 * only ~30% luminance at full strength, and paler at its edges) count,
 * while highlighter yellow (~89%) and light rules don't. */
function isInk(px: Uint8ClampedArray, i: number): boolean {
  return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < 170;
}

/** The separate patches of ink across one band of the image, left to right:
 * runs of columns holding a dark pixel, joined across gaps narrower than
 * `gap` (the space between a chord's letters) and skipping specks shorter
 * than a third of the band. */
function inkPatches(image: HTMLCanvasElement, y0: number, y1: number, gap: number): { x: number; w: number }[] {
  const { width } = image;
  const h = y1 - y0;
  const px = image.getContext("2d")!.getImageData(0, y0, width, h).data;
  const patches: { x: number; w: number; top: number; bottom: number }[] = [];
  for (let x = 0; x < width; x++) {
    let top = h;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      if (!isInk(px, (y * width + x) * 4)) continue;
      top = Math.min(top, y);
      bottom = y;
    }
    if (bottom < 0) continue;
    const last = patches[patches.length - 1];
    if (last && x - (last.x + last.w) <= gap) {
      last.w = x + 1 - last.x;
      last.top = Math.min(last.top, top);
      last.bottom = Math.max(last.bottom, bottom);
    } else patches.push({ x, w: 1, top, bottom });
  }
  return patches.filter((p) => p.bottom - p.top >= h / 3);
}

/** Row-band height (ascenders to descenders) Tesseract reads best at. */
const OCR_LINE_PX = 48;
/** Canvas area cap for the upscaled image — under iOS WebKit's ~16.7 MP. */
const MAX_OCR_PIXELS = 16_000_000;
/** Luminance stretched to black and to white when preparing an image. */
const GREY_BLACK = 60;
const GREY_WHITE = 200;

/** The horizontal bands of the image that hold any ink, top to bottom —
 * roughly one per line of text. */
function inkBands(image: HTMLCanvasElement): Band[] {
  const { width, height } = image;
  const px = image.getContext("2d")!.getImageData(0, 0, width, height).data;
  const bands: Band[] = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    let inked = false;
    for (let i = y * width * 4, end = i + width * 4; y < height && i < end; i += 4) {
      if (isInk(px, i)) {
        inked = true;
        break;
      }
    }
    if (inked && start < 0) start = y;
    else if (!inked && start >= 0) {
      bands.push({ top: start, bottom: y });
      start = -1;
    }
  }
  return bands;
}

/** Typical height of a line of text in the image, in pixels: the median
 * height of its ink bands. Null when the image doesn't split into lines
 * that way (a dim photo, a dark border running down the page). */
function textLineHeight(image: HTMLCanvasElement): number | null {
  const lines = inkBands(image)
    .map((b) => b.bottom - b.top)
    .filter((h) => h >= 3 && h < image.height / 4);
  return lines.length >= 3 ? median(lines) : null;
}

/** Scales an image up so its text is about OCR_LINE_PX tall, and turns it to
 * high-contrast grey. A screenshot or a phone photo of a chart often has
 * text only 10–15 px tall, where Tesseract turns "Dm7" into "om7", "Bb"
 * into "8", drops the slash from "F/C" and skips whole chord rows. The grey
 * levels are stretched so that colored chord text (red is only ~30%
 * luminance, and paler at its edges once scaled) comes out near-black and a
 * highlighter band behind a "Chorus:" label (yellow is ~89%) comes out
 * white; otherwise Tesseract drops the highlighted label as a picture and
 * misreads thin red strokes. */
function prepareForOcr(image: HTMLCanvasElement): HTMLCanvasElement {
  const lineH = textLineHeight(image);
  const fit = Math.sqrt(MAX_OCR_PIXELS / (image.width * image.height));
  let scale = lineH ? Math.min(OCR_LINE_PX / lineH, 6, fit) : 1;
  if (scale < 1.25) scale = 1;
  const c = document.createElement("canvas");
  c.width = Math.round(image.width * scale);
  c.height = Math.round(image.height * scale);
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(image, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    px[i] = px[i + 1] = px[i + 2] = ((lum - GREY_BLACK) * 255) / (GREY_WHITE - GREY_BLACK);
  }
  g.putImageData(data, 0, 0);
  return c;
}

/** Whether an OCR'd chord-row word is a chord (or a bar line). */
function isChordWord(w: PositionedText): boolean {
  return /^\|+$/.test(w.text) || isChordLine(w.text);
}

function overlapsX(a: PositionedText, b: PositionedText): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

/** Whether a first-pass row is probably a chord row: mostly chords, or
 * short words spread out with the wide gaps no lyric line has (garbled
 * chords like "8b fcc" for "Bb F/C C | F" still sit that far apart). */
function looksLikeChordRow(row: Row): boolean {
  const items = row.items;
  if (items.filter(isChordWord).length * 2 >= items.length) return true;
  if (items.length < 2 || items.some((w) => w.text.length > 7)) return false;
  const rowH = median(items.map((w) => w.h));
  const sorted = [...items].sort((a, b) => a.x - b.x);
  return sorted.slice(1).some((w, i) => w.x - (sorted[i].x + sorted[i].w) >= rowH * 3);
}

async function ocrImage(original: HTMLCanvasElement, onProgress: ConvertProgress): Promise<string> {
  onProgress("Preparing text recognition…", 0);
  const worker = await getOcrWorker();
  const { PSM } = await import("tesseract.js");
  const image = prepareForOcr(original);
  ocrProgress = (step, f) => onProgress(step, f * 0.8);
  try {
    const words = await recognizeWords(worker, image, 30);
    // Tesseract reads prose well but often drops or garbles a lone "C" or
    // "G" floating over a lyric, and can skip a sparse chord row outright.
    // So every row that looks like a chord row, and every band of ink the
    // first reading found no words in, is read a second time on its own, as
    // a single line limited to chord characters. Each chord that reading
    // finds replaces whatever the first reading had under it, and chords
    // only the first reading found are kept. Any patch of ink in the row
    // still not covered by a chord is then read by itself, which recovers
    // chords both readings skipped or garbled. The result is used as long as
    // it leaves at least as many chords as before; a skipped band is kept
    // only if all of its ink reads as chords. (Tesseract's "sparse text"
    // mode would seem the natural fit, but it drops single-letter words
    // entirely.)
    const rows = groupRows(words);
    const wordH = median(words.map((w) => w.h));
    const bands = inkBands(image).filter((b) => b.bottom - b.top >= wordH * 0.5 && b.bottom - b.top <= wordH * 3);
    const overlapsY = (a: Band, b: Band) => a.top < b.bottom && b.top < a.bottom;
    const candidates = [
      ...rows.filter(looksLikeChordRow).map((row) => {
        // A garbled row's boxes can be slivers of its letters; its band of
        // ink gives its real height.
        const e = rowExtent(row);
        const band = e.bottom - e.top < wordH * 0.8 ? bands.find((b) => overlapsY(b, e)) : undefined;
        return { row, ...(band ?? e), skipped: false };
      }),
      ...bands
        .filter((b) => !rows.some((r) => overlapsY(b, rowExtent(r))))
        .map((b) => ({ row: { yc: (b.top + b.bottom) / 2, items: [] } as Row, ...b, skipped: true })),
    ];
    if (candidates.length) {
      ocrProgress = null;
      // Global (Otsu) thresholding for the re-reads: on a crop this small
      // Sauvola breaks up thin strokes (a lone "F" comes back as "=").
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: CHORD_CHARS,
        thresholding_method: OTSU_THRESHOLDING,
      });
      try {
        for (let i = 0; i < candidates.length; i++) {
          onProgress("Reading chords…", 0.8 + (0.2 * i) / candidates.length);
          const { row, top, bottom, skipped } = candidates[i];
          const pad = (bottom - top) * 0.35;
          // Stop the padding at the neighbouring rows: a sliver of the
          // lyric above or below is read as stray chord characters.
          const others = rows.filter((r) => r !== row && r.items.length);
          const above = Math.max(0, ...others.filter((r) => r.yc < row.yc).map((r) => rowExtent(r).bottom));
          const below = Math.min(image.height, ...others.filter((r) => r.yc > row.yc).map((r) => rowExtent(r).top));
          const y0 = Math.max(0, Math.floor(Math.max(top - pad, Math.min(above, top))));
          const y1 = Math.min(image.height, Math.ceil(Math.min(bottom + pad, Math.max(below, bottom))));
          const read = async (x0: number, x1: number) =>
            (await recognizeWords(worker, cropRegion(image, x0, y0, x1, y1), 10))
              .filter(isChordWord)
              .map((w) => ({ ...w, x: w.x - CROP_MARGIN + x0, y: w.y - CROP_MARGIN + y0 }));
          // Where both readings give a chord in the same spot, the earlier one
          // stands unless the new one is clearly wider: a reading that loses
          // part of a chord ("Bb" as "B", "F/A" as "F" and "A") is narrower
          // than the whole of it, while one limited to chord characters can
          // also invent a stray "6" beside a "G".
          const replace = (items: PositionedText[], found: PositionedText[]) => {
            const better = found.filter((c) => !items.some((w) => isChordWord(w) && overlapsX(w, c) && w.w * 1.25 >= c.w));
            return [...better, ...items.filter((w) => !better.some((c) => overlapsX(c, w)))];
          };
          let merged = replace(row.items, await read(0, image.width));
          const band = Math.round(bottom) - Math.round(top);
          const patches = inkPatches(image, Math.round(top), Math.round(bottom), band * 0.2).map((p) => ({ ...p, y: top, h: band, text: "" }));
          const covered = (spot: PositionedText) => merged.some((w) => isChordWord(w) && overlapsX(w, spot));
          const readSpan = async (spots: PositionedText[]) => {
            const last = spots[spots.length - 1];
            const x0 = Math.max(0, Math.floor(spots[0].x - band * 0.2));
            const x1 = Math.min(image.width, Math.ceil(last.x + last.w + band * 0.2));
            merged = replace(merged, await read(x0, x1));
          };
          // Neighbouring uncovered patches are read together first: one
          // chord's letters can sit far enough apart to be separate patches
          // ("B" and "b", or "F" and "A" around a faint "/"), and read one at
          // a time they give a wrong chord or none.
          const runs: PositionedText[][] = [];
          patches.forEach((spot, k) => {
            if (covered(spot)) return;
            const run = runs[runs.length - 1];
            const prev = patches[k - 1];
            if (run && run[run.length - 1] === prev && spot.x - (prev.x + prev.w) <= band) run.push(spot);
            else runs.push([spot]);
          });
          for (const run of runs) {
            await readSpan(run);
            if (run.length > 1) for (const spot of run) if (!covered(spot)) await readSpan([spot]);
          }
          // Lone punctuation left in a chord row is a misread speck, and it
          // would stop the row from parsing as chords.
          merged = merged.filter((w) => isChordWord(w) || /[A-Za-z0-9]/.test(w.text));
          if (skipped) {
            if (merged.length && patches.every(covered)) {
              row.items.push(...merged);
              rows.push(row);
            }
          } else if (merged.filter(isChordWord).length >= row.items.filter(isChordWord).length) {
            row.items.splice(0, row.items.length, ...merged);
          }
        }
      } finally {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
          tessedit_char_whitelist: "",
          thresholding_method: SAUVOLA_THRESHOLDING,
        });
      }
    }
    rows.sort((a, b) => a.yc - b.yc);
    // A capital "I" on its own is often read as a bar line; only a chord
    // row can hold one.
    for (const row of rows) {
      if (!row.items.every(isChordWord)) for (const w of row.items) if (w.text === "|") w.text = "I";
    }
    return layoutRows(rows);
  } finally {
    ocrProgress = null;
  }
}

async function renderPdfPage(doc: PdfDoc, n: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n);
  const unscaled = page.getViewport({ scale: 1 });
  // ~2400 px wide is enough for Tesseract to read chart-sized type without
  // making recognition slow on a phone.
  const viewport = page.getViewport({ scale: Math.min(2400, unscaled.width * 3) / unscaled.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return canvas;
}

/** Draws a photo onto a canvas at most ~2400 px on its long side. Going
 * through an <img> applies the camera's EXIF rotation (Tesseract would read
 * a sideways phone photo as-is), and downscaling a 12 MP photo keeps
 * recognition quick without losing chart-sized type. */
async function photoToCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d")!;
  // A screenshot PNG can be transparent; left as-is that reads as black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Converts a picked file (as a data URL) into chart text plus whatever
 * metadata its header gives away. Throws `NoChartTextError` when nothing
 * usable is found. */
export async function convertChartFile(dataUrl: string, kind: "pdf" | "photo", onProgress: ConvertProgress): Promise<ConvertedChart> {
  let raw = "";
  let fromOcr = false;
  if (kind === "pdf") {
    const task = await loadPdf(dataUrl);
    try {
      const doc = await task.promise;
      raw = await pdfTextLayer(doc, onProgress);
      // No text layer: a scan. Fall back to reading the rendered pages.
      if (raw.replace(/\s/g, "").length < 20) {
        fromOcr = true;
        const pages: string[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const canvas = await renderPdfPage(doc, n);
          pages.push(await ocrImage(canvas, (step, f) => onProgress(`${step.replace("…", "")} (page ${n} of ${doc.numPages})…`, (n - 1 + f) / doc.numPages)));
        }
        raw = pages.join("\n\n");
      }
    } finally {
      task.destroy().catch(() => {});
    }
  } else {
    fromOcr = true;
    raw = await ocrImage(await photoToCanvas(dataUrl), onProgress);
  }
  onProgress("Finishing up…", 1);
  const chart = textToChart(raw);
  if (!chart.chordpro.replace(/\s/g, "")) throw new NoChartTextError();
  return { ...chart, fromOcr };
}

const SECTION_WORDS = "verse|chorus|pre-?chorus|bridge|tag|intro|outro|interlude|refrain|ending|coda|vamp|instrumental|breakdown|turnaround";
const BRACKET_SECTION_RE = new RegExp(`^\\s*\\[\\s*((?:${SECTION_WORDS})[^\\]]*)\\]\\s*$`, "i");
const SECTION_START_RE = new RegExp(`^\\s*(?:${SECTION_WORDS})\\b`, "i");
const KEY_RE = /\bkey\s*(?:of)?\s*[:\-–]?\s*([A-G][#b]?m?)(?![a-z])/i;
const TEMPO_RE = /\b(?:tempo\s*[:\-–]?\s*(\d{2,3})|(\d{2,3})\s*bpm)\b/i;
const TIME_RE = /\b(?:time\s*(?:signature)?\s*[:\-–]?\s*)?([2-9]|1[0-2])\/(2|4|8|16)\b/i;
const PAGE_RE = /^\s*(?:page\s*)?\d+\s*(?:of|\/)\s*\d+\s*$/i;
const BRACKET_CHORD_RE = /\[[A-G][#b]?[^\]\s]*\]/;

/** Cleans recovered text into a chart and pulls title/artist/key/tempo/time
 * from the lines above the first chord line or section label, the way
 * printed charts lay out their header. Exported for reuse on pasted text. */
export function textToChart(input: string): Omit<ConvertedChart, "fromOcr"> {
  const lines = input
    .replace(/\r\n?/g, "\n")
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => !PAGE_RE.test(l))
    // "[Verse 1]" is a section label, not a chord — the bracket parser would
    // otherwise read it as a chord named "Verse 1".
    .map((l) => {
      const m = l.match(BRACKET_SECTION_RE);
      return m ? m[1].trim() : l;
    });

  let key: string | undefined;
  let tempo: number | undefined;
  let timeSig: string | undefined;
  let title: string | undefined;
  let artist: string | undefined;

  const bodyStart = lines.findIndex((l) => isChordLine(l) || BRACKET_CHORD_RE.test(l) || SECTION_START_RE.test(l));
  const headerEnd = bodyStart < 0 ? Math.min(1, lines.length) : bodyStart;
  const header = lines.slice(0, headerEnd);
  const kept: string[] = [];
  for (const line of header) {
    const text = line.trim();
    if (!text) continue;
    let isMeta = false;
    const k = text.match(KEY_RE);
    if (k) {
      key ??= (k[1][0].toUpperCase() + k[1].slice(1)).replace(/m$/, "");
      isMeta = true;
    }
    const t = text.match(TEMPO_RE);
    if (t) {
      tempo ??= Number(t[1] ?? t[2]);
      isMeta = true;
    }
    const ts = text.match(TIME_RE);
    if (ts && (isMeta || /time/i.test(text) || text.length <= 5)) {
      timeSig ??= `${ts[1]}/${ts[2]}`;
      isMeta = true;
    }
    if (isMeta) continue;
    if (!title) title = text;
    else if (!artist && text.length <= 60) artist = text.replace(/^(?:words\s*(?:and|&)\s*music\s*)?by\s+/i, "");
    else kept.push(line);
  }

  const body = [...kept, ...(bodyStart < 0 ? lines.slice(headerEnd) : lines.slice(bodyStart))];
  // Collapse runs of blank lines and trim the ends.
  const cleaned: string[] = [];
  for (const l of body) {
    if (!l.trim() && (!cleaned.length || !cleaned[cleaned.length - 1].trim())) continue;
    cleaned.push(l);
  }
  while (cleaned.length && !cleaned[cleaned.length - 1].trim()) cleaned.pop();

  const text = cleaned.join("\n");
  const isBracket = BRACKET_CHORD_RE.test(text);
  if (!key) key = firstChordKey(cleaned, isBracket);
  return { chordpro: text, chartFormat: isBracket ? "chordpro" : "chords-over-lyrics", title, artist, key, tempo, timeSig };
}

/** Falls back to the first chord's root as the key — right for most worship
 * charts, which open on the tonic. Keys in the app are roots only (the key
 * chips and transposition work on the 12 roots), so a minor "Em" is "E". */
function firstChordKey(lines: string[], isBracket: boolean): string | undefined {
  for (const l of lines) {
    // A chord line can open on a bar line ("| G  D"), so take its first chord.
    const tok = isBracket ? l.match(/\[([^\]]+)\]/)?.[1] : isChordLine(l) ? l.trim().split(/\s+/).find((t) => /^[A-G]/.test(t)) : undefined;
    if (!tok) continue;
    const m = tok.match(/^([A-G][#b]?)/);
    if (m) return m[1];
  }
  return undefined;
}
