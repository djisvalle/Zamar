import type { PDFDocument, PDFFont, PDFPage, RGB } from "pdf-lib";
import type { AnnotationObject, AnnotationView, AttachmentKind, Setlist, Song } from "../state/types";
import { parseChordPro, type ChordPosition, type ChordProLine } from "./chordpro";
import { activeKeyChange, keySemitoneShift, type KeyChange } from "./keys";
import { KeyAwareTransposeCalculator } from "./scoreTranspose";
import { transposeMusicXmlFile } from "./musicxmlTranspose";
import { firstAvailableCategory, selectedVersion } from "./attachments";
import { flattenSetlist } from "./setlistCalc";
import bravuraUrl from "../assets/fonts/Bravura.woff2?url";
import { DEFAULT_MARKED_WIDTH, objectBounds } from "./annotations";
import { lightMarkColors, loadMarkFonts, paintAnnotations, type MarkColors, type PointMap } from "./annotationExport";

/** Builds the files Export hands to the share sheet: a PDF songbook, a
 * multi-song ChordPro file, or the set's MusicXML scores. Everything runs
 * on device. */

export type ExportFormat = "pdf" | "chordpro" | "musicxml";

export interface ExportOptions {
  includeChords: boolean;
  perSlotKeys: boolean;
  onePerPage: boolean;
  /** PDF only: print each note's letter name inside its notehead on
   * engraved MusicXML scores. */
  noteNames: boolean;
  /** Settings → Keys "Strict spelling", for transposed chords. */
  strictSpelling: boolean;
  /** PDF only: print each song's Annotate marks over the view they were
   * drawn on. */
  annotations: boolean;
}

/** One song slot of the set and what it will export as. `view` is null when
 * the song has nothing this format can carry (it's listed as skipped). */
export interface PlannedSong {
  song: Song;
  key: string;
  semitones: number;
  /** How the chart's chords are respelled for `key`; null when unchanged. */
  keyChange: KeyChange | null;
  view: "chords" | AttachmentKind | null;
}

export interface ExportedFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** PDF only. */
  pages?: number;
  /** MusicXML only: scores that needed a new key but couldn't be read to
   * re-key (e.g. score-timewise files), so they go out in their written key. */
  untransposed?: string[];
  /** PDF only: marked chord charts printed without their marks, because
   * chords were left out (the marks sit over the chord rows' layout). */
  unmarked?: string[];
}

export type ExportProgress = (label: string, fraction: number) => void;

function hasChart(song: Song): boolean {
  return song.chordpro.trim().length > 0;
}

/** Same choice Live Stage makes: the song's saved default view if it still
 * exists, else its chart, else its highest-priority attachment. */
function pdfView(song: Song): PlannedSong["view"] {
  const saved = song.defaultView;
  if (saved === "chords" && hasChart(song)) return "chords";
  if (saved && saved !== "chords" && song.attachments[saved]) return saved;
  if (hasChart(song)) return "chords";
  return firstAvailableCategory(song.attachments) ?? null;
}

export function planExport(setlist: Setlist, songs: Song[], format: ExportFormat, opts: ExportOptions): PlannedSong[] {
  return flattenSetlist(setlist, songs)
    .filter((e) => e.song)
    .map(({ item, song }) => {
      const s = song!;
      const key = opts.perSlotKeys && item.keyOverride ? item.keyOverride : s.defaultKey;
      const semitones = keySemitoneShift(s.defaultKey, key);
      const view: PlannedSong["view"] =
        format === "pdf" ? pdfView(s) : format === "chordpro" ? (hasChart(s) ? "chords" : null) : s.attachments.musicxml ? "musicxml" : null;
      const keyChange = activeKeyChange(s.defaultKey, key, opts.strictSpelling);
      return { song: s, key, semitones, keyChange, view };
    });
}

export function exportFileBase(setlist: Setlist): string {
  return (setlist.name.trim() || "Setlist").replace(/[\\/:*?"<>|]+/g, "-");
}

async function dataUrlBytes(dataUrl: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
}

/** Splits a chart into stanzas (blank-line separated) and parses each, since
 * the parser itself drops blank lines. */
function chartStanzas(chordpro: string, keyChange: KeyChange | null): ChordProLine[][] {
  return chordpro
    .split(/\n\s*\n/)
    .map((block) => parseChordPro(block, keyChange))
    .filter((lines) => lines.length > 0);
}

// ---------------------------------------------------------------- ChordPro

const METADATA_DIRECTIVE_RE = /^\{\s*(title|t|subtitle|st|artist|key|tempo|time)\s*:/i;

function bracketLine(line: ChordProLine, includeChords: boolean): string {
  if (!includeChords || !line.chords.length) return line.lyric;
  let out = "";
  let cursor = 0;
  let lyric = line.lyric;
  const lastCol = line.chords[line.chords.length - 1].col;
  if (lastCol > lyric.length) lyric = lyric.padEnd(lastCol, " ");
  for (const c of line.chords) {
    out += lyric.slice(cursor, c.col) + `[${c.sym}]`;
    cursor = c.col;
  }
  return (out + lyric.slice(cursor)).trimEnd();
}

function songToChordPro(p: PlannedSong, includeChords: boolean): string {
  const s = p.song;
  const head = [`{title: ${s.title}}`];
  if (s.artist && s.artist !== "Unknown") head.push(`{artist: ${s.artist}}`);
  if (p.key && p.key !== "—") head.push(`{key: ${p.key}}`);
  if (s.tempo) head.push(`{tempo: ${s.tempo}}`);
  if (s.timeSig) head.push(`{time: ${s.timeSig}}`);
  const body = chartStanzas(s.chordpro, p.keyChange)
    .map((lines) =>
      lines
        .filter((l) => !(l.isDirective && METADATA_DIRECTIVE_RE.test(l.lyric.trim())))
        .map((l) => (l.isSection ? `{comment: ${l.lyric}}` : l.isDirective ? l.lyric.trim() : bracketLine(l, includeChords)))
        .join("\n")
    )
    .filter(Boolean)
    .join("\n\n");
  return `${head.join("\n")}\n\n${body}\n`;
}

export function buildChordPro(setlist: Setlist, plan: PlannedSong[], opts: ExportOptions): ExportedFile {
  const text = plan
    .filter((p) => p.view === "chords")
    .map((p) => songToChordPro(p, opts.includeChords))
    .join("\n{new_song}\n\n");
  return { name: `${exportFileBase(setlist)}.cho`, mime: "text/plain", bytes: new TextEncoder().encode(text) };
}

// ---------------------------------------------------------------- MusicXML

export async function buildMusicXml(setlist: Setlist, plan: PlannedSong[], onProgress: ExportProgress): Promise<ExportedFile> {
  const scores = plan.filter((p) => p.view === "musicxml");
  const files: { name: string; bytes: Uint8Array }[] = [];
  const untransposed: string[] = [];
  for (let i = 0; i < scores.length; i++) {
    const p = scores[i];
    onProgress(`Adding ${p.song.title}`, i / scores.length);
    const version = selectedVersion(p.song.attachments.musicxml!);
    const ext = version.name.match(/\.(mxl|musicxml|xml)$/i)?.[1].toLowerCase() ?? "musicxml";
    const safeTitle = p.song.title.replace(/[\\/:*?"<>|]+/g, "-");
    let bytes = await dataUrlBytes(version.dataUrl);
    // Same test the PDF uses to engrave a score in the set key.
    if (p.semitones !== 0 || p.key !== p.song.defaultKey) {
      const rekeyed = await transposeMusicXmlFile(bytes, p.semitones, p.key).catch(() => null);
      if (rekeyed) bytes = rekeyed;
      else untransposed.push(p.song.title);
    }
    files.push({ name: `${String(i + 1).padStart(2, "0")} ${safeTitle}.${ext}`, bytes });
  }
  if (files.length === 1) {
    const f = files[0];
    const ext = f.name.split(".").pop()!;
    return {
      name: `${exportFileBase(setlist)}.${ext}`,
      mime: ext === "mxl" ? "application/vnd.recordare.musicxml" : "application/vnd.recordare.musicxml+xml",
      bytes: f.bytes,
      untransposed,
    };
  }
  const { zipSync } = await import("fflate");
  const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])), { level: 6 });
  return { name: `${exportFileBase(setlist)} (MusicXML).zip`, mime: "application/zip", bytes: zip, untransposed };
}

// ---------------------------------------------------------------- PDF

const MARGIN = 54;
/** Scores use narrower side margins than chart text, since notation needs
 * the width more than the text does. */
const SCORE_MARGIN = 30;
/** How much larger than OSMD's default size scores are engraved. Larger
 * notation means fewer measures per line. */
const SCORE_ZOOM = 1.2;
/** Width of the offscreen OSMD host, in CSS px. */
const SCORE_HOST_PX = 900;
const INK: [number, number, number] = [0.11, 0.11, 0.12];
const MUTED: [number, number, number] = [0.45, 0.45, 0.48];
/** The app's steel-blue accent, so printed chords match what's on stage. */
const CHORD_INK: [number, number, number] = [0.16, 0.36, 0.55];

/** US Letter where it's the local paper size, A4 everywhere else. */
function pageSize(): [number, number] {
  return /-(US|CA|MX|PH|CL|CO|VE)$/i.test(navigator.language || "") ? [612, 792] : [595.28, 841.89];
}

interface PdfCtx {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  rgb: (r: number, g: number, b: number) => RGB;
  size: [number, number];
  page: PDFPage | null;
  y: number;
  /** Characters the standard fonts can encode (WinAnsi); anything else is
   * replaced so one stray emoji can't fail the whole export. */
  charset: Set<number>;
}

function safe(ctx: PdfCtx, text: string): string {
  let out = "";
  for (const ch of text.replace(/\t/g, "    ")) out += ctx.charset.has(ch.codePointAt(0)!) ? ch : "?";
  return out;
}

function newPage(ctx: PdfCtx) {
  ctx.page = ctx.doc.addPage(ctx.size);
  ctx.y = ctx.size[1] - MARGIN;
}

/** Starts a new page when fewer than `needed` points are left on this one. */
function ensureRoom(ctx: PdfCtx, needed: number) {
  if (!ctx.page || ctx.y - needed < MARGIN) newPage(ctx);
}

function drawText(ctx: PdfCtx, text: string, x: number, size: number, font: PDFFont, color: [number, number, number]) {
  ctx.page!.drawText(safe(ctx, text), { x, y: ctx.y, size, font, color: ctx.rgb(...color) });
}

/** How far songHeader() moves down the page: title, meta line, spacing. */
const SONG_HEADER_HEIGHT = 18 + 15 + 14;

function songHeader(ctx: PdfCtx, p: PlannedSong) {
  ensureRoom(ctx, 60);
  ctx.y -= 18;
  drawText(ctx, p.song.title, MARGIN, 18, ctx.bold, INK);
  const meta = [
    p.song.artist && p.song.artist !== "Unknown" ? p.song.artist : "",
    p.key && p.key !== "—" ? `Key ${p.key}` : "",
    p.song.tempo ? `${p.song.tempo} BPM` : "",
    p.song.timeSig,
  ].filter(Boolean);
  ctx.y -= 15;
  if (meta.length) drawText(ctx, meta.join("  ·  "), MARGIN, 10, ctx.regular, MUTED);
  ctx.y -= 14;
}

const LYRIC_SIZE = 12;
const CHORD_SIZE = 10.5;

/** Breaks a lyric line (with its chords) into pieces that fit the width,
 * at word boundaries, carrying each chord with the syllable under it. */
function wrapLine(ctx: PdfCtx, line: ChordProLine, maxWidth: number): { lyric: string; chords: ChordPosition[] }[] {
  const lyric = safe(ctx, line.lyric);
  if (ctx.regular.widthOfTextAtSize(lyric, LYRIC_SIZE) <= maxWidth) return [{ lyric, chords: line.chords }];
  const pieces: { lyric: string; chords: ChordPosition[] }[] = [];
  let start = 0;
  while (start < lyric.length) {
    let end = lyric.length;
    while (end > start && ctx.regular.widthOfTextAtSize(lyric.slice(start, end), LYRIC_SIZE) > maxWidth) {
      const space = lyric.lastIndexOf(" ", end - 1);
      end = space > start ? space : end - 1;
    }
    if (end <= start) end = start + 1;
    const last = end >= lyric.length;
    pieces.push({
      lyric: lyric.slice(start, end),
      chords: line.chords.filter((c) => c.col >= start && (last || c.col < end)).map((c) => ({ ...c, col: c.col - start })),
    });
    start = end;
    while (lyric[start] === " ") start++;
  }
  return pieces;
}

function drawChartLine(ctx: PdfCtx, lyric: string, chords: ChordPosition[], includeChords: boolean) {
  const showChords = includeChords && chords.length > 0;
  const hasLyric = lyric.trim().length > 0;
  ensureRoom(ctx, (showChords ? 13 : 0) + (hasLyric ? 16 : 0));
  if (showChords) {
    ctx.y -= 12;
    // A chord sits over the lyric character at its column; past the end of
    // the lyric (or on a chord-only line) columns fall back to an average
    // character width. Chords never overlap the previous one.
    const avgChar = LYRIC_SIZE * 0.5;
    const lyricW = ctx.regular.widthOfTextAtSize(lyric, LYRIC_SIZE);
    let minX = MARGIN;
    for (const c of chords) {
      const colX =
        c.col <= lyric.length
          ? ctx.regular.widthOfTextAtSize(lyric.slice(0, c.col), LYRIC_SIZE)
          : lyricW + (c.col - lyric.length) * avgChar;
      const x = Math.max(MARGIN + colX, minX);
      drawText(ctx, c.sym, x, CHORD_SIZE, ctx.bold, CHORD_INK);
      minX = x + ctx.bold.widthOfTextAtSize(safe(ctx, c.sym), CHORD_SIZE) + 5;
    }
  }
  if (hasLyric) {
    ctx.y -= showChords ? 15 : 16;
    drawText(ctx, lyric, MARGIN, LYRIC_SIZE, ctx.regular, INK);
  }
}

function drawChart(ctx: PdfCtx, p: PlannedSong, includeChords: boolean) {
  const maxWidth = ctx.size[0] - MARGIN * 2;
  chartStanzas(p.song.chordpro, p.keyChange).forEach((stanza, i) => {
    if (i > 0) ctx.y -= 9;
    for (const line of stanza) {
      if (line.isDirective) continue;
      if (line.isSection) {
        ensureRoom(ctx, 40);
        ctx.y -= 16;
        drawText(ctx, line.lyric, MARGIN, LYRIC_SIZE, ctx.bold, INK);
        ctx.y -= 2;
        continue;
      }
      for (const piece of wrapLine(ctx, line, maxWidth)) drawChartLine(ctx, piece.lyric, piece.chords, includeChords);
    }
  });
}

// ---------------------------------------------------------------- Marks

/** Where Live Stage lays out an attachment inside the box marks are saved
 * against (LiveStage.tsx's `content`): 14px side padding, and 16px top
 * padding plus the attachment wrapper's 8px. */
const STAGE_SIDE = 14;
const STAGE_TOP = 24;
/** The photo's 1px border on stage, inside its width. */
const STAGE_IMAGE_BORDER = 1;
/** Gap under each PDF page on stage (PdfPages.tsx). */
const STAGE_PDF_GAP = 8;

/** A song's marks on one view, and the content width they were made at. */
interface StageMarks {
  items: AnnotationObject[];
  width: number;
  colors: MarkColors;
}

function stageMarks(song: Song, view: AnnotationView, opts: ExportOptions, colors: MarkColors): StageMarks | null {
  const items = opts.annotations ? song.annotations[view] ?? [] : [];
  if (!items.length) return null;
  return { items, width: song.annotationWidths?.[view] ?? DEFAULT_MARKED_WIDTH, colors };
}

function canvasBytes(canvas: HTMLCanvasElement, type: "image/jpeg" | "image/png"): Promise<Uint8Array> {
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, 0.9)).then(
    async (blob) => new Uint8Array(await blob.arrayBuffer())
  );
}

/** Prints marks over a copied PDF's pages. On stage the pages stack at the
 * content width with a gap between them; each page gets a transparent
 * overlay of the marks that fall on it. Rotated pages are skipped. */
async function overlayPdfMarks(doc: PDFDocument, pages: PDFPage[], m: StageMarks) {
  const shown = m.width - STAGE_SIDE * 2;
  let top = STAGE_TOP;
  for (const pg of pages) {
    const box = pg.getCropBox();
    const angle = ((pg.getRotation().angle % 360) + 360) % 360;
    const h = shown * (angle % 180 ? box.width / box.height : box.height / box.width);
    const pageTop = top;
    top += h + STAGE_PDF_GAP;
    if (angle !== 0) continue;
    const onPage = m.items.filter((it) => {
      const b = objectBounds(it);
      return b.bottom >= pageTop - 24 && b.top <= pageTop + h + 24;
    });
    if (!onPage.length) continue;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(box.width * 2);
    canvas.height = Math.round(box.height * 2);
    const k = canvas.width / shown;
    const map: PointMap = (p) => ({ x: (p.x - STAGE_SIDE) * k, y: (p.y - pageTop) * k });
    paintAnnotations(canvas.getContext("2d")!, onPage, map, k, m.colors);
    const png = await doc.embedPng(await canvasBytes(canvas, "image/png"));
    pg.drawImage(png, { x: box.x, y: box.y, width: box.width, height: box.height });
  }
}

/** Loads an image through an <img> (which applies EXIF rotation) and
 * re-encodes it as a JPEG no bigger than print needs, with any marks drawn
 * over it where they sat on the photo on stage. */
async function imageToJpeg(dataUrl: string, marks: StageMarks | null = null): Promise<Uint8Array> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (marks) {
    const inset = STAGE_SIDE + STAGE_IMAGE_BORDER;
    const k = canvas.width / (marks.width - inset * 2);
    const map: PointMap = (p) => ({ x: (p.x - inset) * k, y: (p.y - STAGE_TOP - STAGE_IMAGE_BORDER) * k });
    paintAnnotations(g, marks.items, map, k, marks.colors);
  }
  return canvasBytes(canvas, "image/jpeg");
}

/** Renders a marked chord chart the way it looked on stage, marks and all,
 * as JPEG slices at `pageWidth` points wide: the first fits `firstHeight`
 * points (under the song header), the rest `restHeight`. The chart is laid out offscreen at the width it was marked at, with
 * the same component and text size, then copied onto a canvas glyph by
 * glyph, so every mark lands on the lyric it was drawn against. */
async function renderMarkedChart(
  p: PlannedSong,
  marks: StageMarks,
  pageWidth: number,
  firstHeight: number,
  restHeight: number
): Promise<Uint8Array[]> {
  const [{ createElement }, { flushSync }, { createRoot }, { ChordChart }] = await Promise.all([
    import("react"),
    import("react-dom"),
    import("react-dom/client"),
    import("../components/ChordChart"),
  ]);
  const host = document.createElement("div");
  host.className = "device device--native";
  host.setAttribute("data-theme", "light");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${marks.width}px;height:auto;display:block;border:none;border-radius:0;overflow:visible;background:#fff;color:#000`;
  const inner = document.createElement("div");
  // LiveStage.tsx's `content` box for the chords view.
  inner.style.cssText = "padding:16px 14px;display:flex;flex-direction:column;gap:8px";
  host.appendChild(inner);
  document.body.appendChild(host);
  const root = createRoot(inner);
  try {
    flushSync(() =>
      root.render(createElement(ChordChart, { chordpro: p.song.chordpro, keyChange: p.keyChange, fontScale: (p.song.chordsTextScale ?? 100) / 100 }))
    );
    await document.fonts?.ready;
    const origin = host.getBoundingClientRect();
    const cssH = Math.ceil(host.scrollHeight);
    const s = Math.min(3, 16000 / Math.max(cssH, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(marks.width * s);
    canvas.height = Math.round(cssH * s);
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);

    // Backgrounds first (chord chips), then text on top.
    for (const el of Array.from(host.querySelectorAll<HTMLElement>("*"))) {
      const cs = getComputedStyle(el);
      if (cs.backgroundColor === "transparent" || cs.backgroundColor === "rgba(0, 0, 0, 0)") continue;
      const r = el.getBoundingClientRect();
      g.fillStyle = cs.backgroundColor;
      g.beginPath();
      g.roundRect((r.left - origin.left) * s, (r.top - origin.top) * s, r.width * s, r.height * s, (parseFloat(cs.borderTopLeftRadius) || 0) * s);
      g.fill();
    }
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      const cs = getComputedStyle(node.parentElement!);
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) * s}px ${cs.fontFamily}`;
      g.fillStyle = cs.color;
      const descent = g.measureText("Hg").fontBoundingBoxDescent;
      const upper = cs.textTransform === "uppercase";
      for (let i = 0; i < text.length; i++) {
        const ch = upper ? text[i].toUpperCase() : text[i];
        if (!ch.trim()) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (!r || !r.width) continue;
        g.fillText(ch, (r.left - origin.left) * s, (r.bottom - origin.top) * s - descent);
      }
    }
    paintAnnotations(g, marks.items, (pt) => ({ x: pt.x * s, y: pt.y * s }), s, marks.colors);

    // Cut between lines, never through one.
    const cuts = Array.from(inner.querySelectorAll(".chord-chart > *")).map((c) => c.getBoundingClientRect().bottom - origin.top);
    const ptPerPx = pageWidth / marks.width;
    const slices: Uint8Array[] = [];
    for (let start = 0; start < cssH - 1; ) {
      const maxSlice = (slices.length ? restHeight : firstHeight) / ptPerPx;
      const fits = cuts.filter((c) => c > start + 1 && c <= start + maxSlice);
      let end = start + maxSlice >= cssH ? cssH : fits.length ? Math.max(...fits) + 4 : start + maxSlice;
      end = Math.min(end, cssH);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = Math.max(1, Math.round((end - start) * s));
      slice.getContext("2d")!.drawImage(canvas, 0, -Math.round(start * s));
      slices.push(await canvasBytes(slice, "image/jpeg"));
      start = end;
    }
    return slices;
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Places images one per page under the song header, scaled to fit.
 * `sideMargin` lets scores run wider than the chart text. */
async function drawImagePages(ctx: PdfCtx, p: PlannedSong, jpegs: Uint8Array[], sideMargin = MARGIN) {
  for (let i = 0; i < jpegs.length; i++) {
    newPage(ctx);
    if (i === 0) songHeader(ctx, p);
    const img = await ctx.doc.embedJpg(jpegs[i]);
    const maxW = ctx.size[0] - sideMargin * 2;
    const maxH = ctx.y - MARGIN;
    const s = Math.min(maxW / img.width, maxH / img.height, 1.5);
    const w = img.width * s;
    const h = img.height * s;
    ctx.page!.drawImage(img, { x: sideMargin + (maxW - w) / 2, y: ctx.y - h, width: w, height: h });
  }
  ctx.page = null; // the next song starts on a fresh page
}

/** Engraves a MusicXML score with OSMD in the slot's key, one SVG per
 * printed page, and rasterizes each page for embedding. */
const SVG_NS = "http://www.w3.org/2000/svg";

/** First codepoint of each SMuFL "note name noteheads" run (Bravura has
 * them all). Each run goes A♭ A A♯ B♭ B B♯ … G♭ G G♯, three per letter. */
const NAME_HEAD_BASE = { black: 0xe196, half: 0xe17f, whole: 0xe168 } as const;
const LETTER_ORDER = ["A", "B", "C", "D", "E", "F", "G"];
/** Ink width of Bravura's note-name heads, as a fraction of the font size
 * (measured from the font; every letter of a shape is the same width).
 * Fixed numbers, so stem placement doesn't depend on when the font has
 * loaded or on a platform's text measurement. */
const NAME_HEAD_WIDTH = { black: 0.36, half: 0.375, whole: 0.5 } as const;
/** Ink height of the note-name heads, as a fraction of the font size. */
const NAME_HEAD_HEIGHT = 0.314;
/** Each head's outline as an ellipse (fitted to the glyph, in font-size
 * units from the glyph origin; angle in degrees). A white copy goes under
 * the glyph so staff and ledger lines don't show through the letter or a
 * hollow head, as in MuseScore. */
const NAME_HEAD_SHAPE = {
  black: { cx: 0.1763, cy: -0.0019, rx: 0.1901, ry: 0.1261, angle: -26.6 },
  half: { cx: 0.1796, cy: -0.0015, rx: 0.1913, ry: 0.1333, angle: -26.9 },
  whole: { cx: 0.2415, cy: 0.0038, rx: 0.246, ry: 0.1466, angle: 0.6 },
} as const;

/** The SMuFL note-name notehead glyph for a pitch and duration — the same
 * glyphs MuseScore's "note names" notehead scheme uses. Double sharps and
 * flats have no glyph of their own and fall back to the plain letter. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nameHeadGlyph(Pitch: any, pitch: any, kind: keyof typeof NAME_HEAD_BASE): string {
  const letter: string = Pitch.getNoteEnumString(pitch.FundamentalNote);
  const shift: number = Pitch.HalfTonesFromAccidental(pitch.Accidental);
  const acc = shift === 1 ? 2 : shift === -1 ? 0 : 1;
  return String.fromCodePoint(NAME_HEAD_BASE[kind] + LETTER_ORDER.indexOf(letter) * 3 + acc);
}

let bravuraCss: Promise<string> | null = null;

/** An @font-face rule carrying Bravura as a data URL. The score is
 * rasterized by loading its SVG as an image, and an SVG image can't reach
 * the page's fonts, so the font has to travel inside the SVG itself. */
function bravuraFontFace(): Promise<string> {
  bravuraCss ??= (async () => {
    const bytes = await dataUrlBytes(bravuraUrl);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `@font-face{font-family:"BravuraExport";src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");}`;
  })();
  return bravuraCss;
}

/** Swaps each notehead for a notehead with the note's name inside it, like
 * MuseScore's "note names" notehead scheme: OSMD's own notehead is hidden
 * and the matching SMuFL note-name glyph from Bravura is drawn in its place
 * (black, half and whole shapes follow the note's duration). Names follow
 * the transposed pitch, so they match the set key. OSMD has no built-in for
 * this; it reads the graphical notes and finds their notehead paths in the
 * rendered SVG. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function drawNoteNames(osmd: any, Pitch: any, host: HTMLElement) {
  const css = await bravuraFontFace();
  for (const svg of Array.from(host.querySelectorAll("svg"))) {
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = css;
    svg.insertBefore(style, svg.firstChild);
  }
  const groups: StemGroup[] = [];
  for (const row of osmd.GraphicSheet.MeasureList) {
    for (const measure of row) {
      if (!measure) continue;
      for (const entry of measure.staffEntries) {
        for (const gve of entry.graphicalVoiceEntries) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const notes = gve.notes.filter((n: any) => !n.sourceNote.isRest() && (n.sourceNote.TransposedPitch ?? n.sourceNote.Pitch));
          if (!notes.length) continue;
          // One VexFlow note carries every notehead of a chord, so heads
          // and notes are paired up by pitch order: lowest note, lowest head.
          const heads: SVGGraphicsElement[] = notes[0].getNoteheadSVGs?.() ?? [];
          if (heads.length !== notes.length) continue;
          const svg = heads[0].ownerSVGElement;
          const ctm = svg?.getScreenCTM()?.inverse();
          if (!svg || !ctm) continue;
          const toSvg = (el: Element) => {
            const r = el.getBoundingClientRect();
            const a = new DOMPoint(r.left, r.top).matrixTransform(ctm);
            const b = new DOMPoint(r.right, r.bottom).matrixTransform(ctm);
            return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
          };
          const placed = heads.map((el) => ({ el, ...toSvg(el) })).sort((p, q) => q.y - p.y);
          const stem: SVGGraphicsElement | undefined = notes[0].getStemSVG?.() ?? undefined;
          // Flags and beams hang off the stem, so they move with it.
          const attached: Element[] = [notes[0].getFlagSVG?.(), ...(notes[0].getBeamSVGs?.() ?? [])].filter(Boolean);
          const group: StemGroup = { stem, stemBox: stem ? toSvg(stem) : undefined, attached, heads: placed, glyphs: [] };
          groups.push(group);
          const byPitch = [...notes].sort(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (m: any, n: any) => (m.sourceNote.TransposedPitch ?? m.sourceNote.Pitch).getHalfTone() - (n.sourceNote.TransposedPitch ?? n.sourceNote.Pitch).getHalfTone()
          );
          byPitch.forEach((gNote, i) => {
            const head = placed[i];
            if (!head || head.h <= 0) return;
            const note = gNote.sourceNote;
            const len: number = note.Length.RealValue;
            const kind = len >= 1 ? "whole" : len >= 0.5 ? "half" : "black";
            // Bravura draws note-name heads about 1.26 staff spaces tall,
            // bigger than a regular head. They're scaled down to the
            // regular head's height, as MuseScore does, so they sit inside
            // their line or space and chord notes don't collide. The
            // glyph's baseline is the note's own line or space.
            // Placed by its known ink width rather than text-anchor, which
            // centres on the advance width and so depends on the font.
            const size = head.h / NAME_HEAD_HEIGHT;
            const width = NAME_HEAD_WIDTH[kind] * size;
            const left = head.x + head.w / 2 - width / 2;
            const baseline = head.y + head.h / 2;
            const shape = NAME_HEAD_SHAPE[kind];
            const cx = left + shape.cx * size;
            const cy = baseline + shape.cy * size;
            const mask = document.createElementNS(SVG_NS, "ellipse");
            mask.setAttribute("cx", String(cx));
            mask.setAttribute("cy", String(cy));
            // Just inside the outline, so the white never shows past it.
            mask.setAttribute("rx", String(shape.rx * size * 0.96));
            mask.setAttribute("ry", String(shape.ry * size * 0.96));
            mask.setAttribute("transform", `rotate(${shape.angle} ${cx} ${cy})`);
            mask.setAttribute("fill", "#fff");
            svg.appendChild(mask);
            const text = document.createElementNS(SVG_NS, "text");
            text.setAttribute("x", String(left));
            text.setAttribute("y", String(baseline));
            text.setAttribute("font-family", "BravuraExport");
            text.setAttribute("font-size", String(size));
            text.setAttribute("fill", "#000");
            text.textContent = nameHeadGlyph(Pitch, note.TransposedPitch ?? note.Pitch, kind);
            head.el.style.visibility = "hidden";
            svg.appendChild(text);
            group.glyphs.push({ left, right: left + width });
          });
        }
      }
    }
  }
  reattachStems(groups);
}

type Box = { x: number; y: number; w: number; h: number };
interface StemGroup {
  stem?: SVGGraphicsElement;
  stemBox?: Box;
  attached: Element[];
  heads: (Box & { el: SVGGraphicsElement })[];
  glyphs: { left: number; right: number }[];
}

/** Note-name heads are wider than the noteheads OSMD spaced the stems for,
 * so each stem is slid sideways onto the new heads' edge: the right edge
 * for an up-stem, the left edge for a down-stem, the way a stem meets a
 * regular notehead. Without this a stem runs through the middle of an open
 * (half-note) head. */
function reattachStems(groups: StemGroup[]) {
  for (const g of groups) {
    if (!g.stem || !g.stemBox || !g.glyphs.length) continue;
    const oldLeft = Math.min(...g.heads.map((h) => h.x));
    const oldRight = Math.max(...g.heads.map((h) => h.x + h.w));
    const newLeft = Math.min(...g.glyphs.map((b) => b.left));
    const newRight = Math.max(...g.glyphs.map((b) => b.right));
    // An up-stem rises from the heads; a down-stem hangs below them.
    const headsMidY = g.heads.reduce((sum, h) => sum + h.y + h.h / 2, 0) / g.heads.length;
    const stemUp = g.stemBox.y + g.stemBox.h / 2 < headsMidY;
    const dx = stemUp ? newRight - oldRight : newLeft - oldLeft;
    if (Math.abs(dx) <= 0.01) continue;
    for (const el of [g.stem, ...g.attached]) el.setAttribute("transform", `translate(${dx} 0)`);
  }
}

/** Crops the blank space below the last system, so a page with room to
 * spare (the first, under the song header, or the last) isn't shrunk to
 * fit its empty bottom. */
function trimBottom(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = canvas;
  const data = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  let last = height - 1;
  rows: for (; last > 0; last--) {
    for (let x = 0, i = last * width * 4; x < width; x++, i += 4) if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) break rows;
  }
  const h = Math.min(height, last + Math.round(width * 0.02));
  if (h >= height - 1) return canvas;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = h;
  out.getContext("2d")!.drawImage(canvas, 0, 0);
  return out;
}

/** Engraves a score as JPEG pages. `area` is the PDF space a page of score
 * fills (points); OSMD's pages take its proportions, and OSMD's own page
 * margins are kept small since the PDF page already has margins. */
async function renderScorePages(
  dataUrl: string,
  semitones: number,
  targetKey: string,
  area: { w: number; h: number },
  noteNames: boolean,
  marks: StageMarks | null
): Promise<Uint8Array[]> {
  const osmdModule = await import("opensheetmusicdisplay");
  const { OpenSheetMusicDisplay, Pitch, unitInPixels } = osmdModule;
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${SCORE_HOST_PX}px;background:#fff`;
  document.body.appendChild(host);
  try {
    const osmd = new OpenSheetMusicDisplay(host, {
      backend: "svg",
      autoResize: false,
      pageBackgroundColor: "#FFFFFF",
      // The song header above the score already carries the title.
      drawTitle: false,
      drawPartNames: true,
      disableCursor: true,
    });
    const transposer = new KeyAwareTransposeCalculator(osmdModule);
    osmd.TransposeCalculator = transposer;
    osmd.setCustomPageFormat(area.w, area.h);
    const rules = osmd.EngravingRules;
    rules.PageLeftMargin = 2;
    rules.PageRightMargin = 2;
    rules.PageTopMargin = 4;
    rules.PageBottomMargin = 4;
    // Tighter system spacing than OSMD's default, so the larger notation
    // still fits a typical song on one page.
    rules.MinimumDistanceBetweenSystems = 4;
    rules.MinSkyBottomDistBetweenSystems = 3;
    await osmd.load(await (await fetch(dataUrl)).blob());
    osmd.Zoom = SCORE_ZOOM;
    transposer.apply(osmd.Sheet, semitones, targetKey);
    // A new Transpose only reaches the notes through updateGraphic(); a bare
    // render() re-keys the key signature but leaves every note where it was.
    osmd.updateGraphic();
    osmd.render();
    if (noteNames) await drawNoteNames(osmd, Pitch, host);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sheet = (osmd as any).GraphicSheet;
    const out: Uint8Array[] = [];
    const svgs = Array.from(host.querySelectorAll("svg"));
    for (let pageIndex = 0; pageIndex < svgs.length; pageIndex++) {
      const svg = svgs[pageIndex];
      const w = svg.width.baseVal.value || svg.getBoundingClientRect().width;
      const h = svg.height.baseVal.value || svg.getBoundingClientRect().height;
      if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const scale = 2400 / w;
        const canvas = document.createElement("canvas");
        canvas.width = 2400;
        canvas.height = Math.round(h * scale);
        const g = canvas.getContext("2d")!;
        g.fillStyle = "#fff";
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (marks) {
          // Score marks follow their measure anchor, not a pixel position:
          // the export engraves at its own size and line breaks. Unanchored
          // marks (saved before anchoring) are left out. Mark sizes assume
          // the score was marked at its default on-stage zoom.
          const f = unitInPixels * osmd.Zoom * scale;
          const map: PointMap = (_p, anchor) => {
            const measure = anchor && sheet.MeasureList[anchor.measureIndex]?.[anchor.staffIndex];
            if (!measure || sheet.MusicPages.indexOf(measure.ParentMusicSystem?.Parent) !== pageIndex) return null;
            const pos = measure.PositionAndShape.AbsolutePosition;
            const size = measure.PositionAndShape.Size;
            return { x: (pos.x + anchor!.fx * size.width) * f, y: (pos.y + anchor!.fy * size.height) * f };
          };
          paintAnnotations(g, marks.items, map, osmd.Zoom * scale, marks.colors);
        }
        const page = trimBottom(canvas);
        const blob = await new Promise<Blob>((res, rej) => page.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.92));
        out.push(new Uint8Array(await blob.arrayBuffer()));
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return out;
  } finally {
    host.remove();
  }
}

export async function buildPdf(setlist: Setlist, plan: PlannedSong[], opts: ExportOptions, onProgress: ExportProgress): Promise<ExportedFile> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(setlist.name);
  doc.setCreator("Zamar");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx: PdfCtx = {
    doc,
    regular,
    bold,
    rgb,
    size: pageSize(),
    page: null,
    y: 0,
    charset: new Set([...regular.getCharacterSet(), 10]),
  };
  const letter = ctx.size[0] === 612;
  const colors = lightMarkColors();
  if (opts.annotations) await loadMarkFonts();
  const unmarked: string[] = [];

  const songs = plan.filter((p) => p.view);
  for (let i = 0; i < songs.length; i++) {
    const p = songs[i];
    onProgress(`Adding ${p.song.title}`, i / songs.length);
    const view = p.view ?? "chords";
    const marks = p.view ? stageMarks(p.song, view, opts, colors) : null;
    if (p.view === "chords" && marks && opts.includeChords) {
      const pageWidth = ctx.size[0] - MARGIN * 2;
      const pageHeight = ctx.size[1] - MARGIN * 2;
      const slices = await renderMarkedChart(p, marks, pageWidth, pageHeight - SONG_HEADER_HEIGHT, pageHeight);
      await drawImagePages(ctx, p, slices);
    } else if (p.view === "chords") {
      if (marks) unmarked.push(p.song.title);
      if (opts.onePerPage || !ctx.page) newPage(ctx);
      else {
        ctx.y -= 26;
        ensureRoom(ctx, 140);
      }
      songHeader(ctx, p);
      drawChart(ctx, p, opts.includeChords);
    } else if (p.view === "pdf") {
      const src = await PDFDocument.load(await dataUrlBytes(selectedVersion(p.song.attachments.pdf!).dataUrl), { ignoreEncryption: true });
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((pg) => doc.addPage(pg));
      if (marks) await overlayPdfMarks(doc, pages, marks);
      ctx.page = null;
    } else if (p.view === "image") {
      await drawImagePages(ctx, p, [await imageToJpeg(selectedVersion(p.song.attachments.image!).dataUrl, marks)]);
    } else if (p.view === "musicxml") {
      const area = { w: ctx.size[0] - SCORE_MARGIN * 2, h: ctx.size[1] - MARGIN * 2 };
      const pages = await renderScorePages(selectedVersion(p.song.attachments.musicxml!).dataUrl, p.semitones, p.key, area, opts.noteNames, marks);
      await drawImagePages(ctx, p, pages, SCORE_MARGIN);
    }
  }
  if (!doc.getPageCount()) newPage(ctx);

  // Footer on every page: set name and page number.
  const total = doc.getPageCount();
  doc.getPages().forEach((pg, i) => {
    const { width } = pg.getSize();
    const label = `${i + 1} / ${total}`;
    const name = safe(ctx, setlist.name);
    pg.drawText(name, { x: MARGIN, y: 28, size: 8, font: regular, color: rgb(...MUTED) });
    pg.drawText(label, { x: width - MARGIN - regular.widthOfTextAtSize(label, 8), y: 28, size: 8, font: regular, color: rgb(...MUTED) });
  });

  onProgress("Finishing up", 1);
  const bytes = await doc.save();
  return { name: `${exportFileBase(setlist)}.pdf`, mime: "application/pdf", bytes, pages: total, unmarked };
}
