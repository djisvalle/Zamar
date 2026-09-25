import type { PDFDocument, PDFFont, PDFPage, RGB } from "pdf-lib";
import type { AttachmentKind, Setlist, Song } from "../state/types";
import { keySemitoneShift, parseChordPro, type ChordPosition, type ChordProLine } from "./chordpro";
import { firstAvailableCategory, selectedVersion } from "./attachments";
import { flattenSetlist } from "./setlistCalc";

/** Builds the files Export hands to the share sheet: a PDF songbook, a
 * multi-song ChordPro file, or the set's MusicXML scores. Everything runs
 * on device. */

export type ExportFormat = "pdf" | "chordpro" | "musicxml";

export interface ExportOptions {
  includeChords: boolean;
  perSlotKeys: boolean;
  onePerPage: boolean;
}

/** One song slot of the set and what it will export as. `view` is null when
 * the song has nothing this format can carry (it's listed as skipped). */
export interface PlannedSong {
  song: Song;
  key: string;
  semitones: number;
  view: "chords" | AttachmentKind | null;
}

export interface ExportedFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
  /** PDF only. */
  pages?: number;
  /** MusicXML only: scores that were in a different set key, which can't be
   * re-keyed in the file itself and so go out in their written key. */
  untransposed?: string[];
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
      return { song: s, key, semitones, view };
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
function chartStanzas(chordpro: string, semitones: number): ChordProLine[][] {
  return chordpro
    .split(/\n\s*\n/)
    .map((block) => parseChordPro(block, semitones))
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
  const body = chartStanzas(s.chordpro, p.semitones)
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
    files.push({ name: `${String(i + 1).padStart(2, "0")} ${safeTitle}.${ext}`, bytes: await dataUrlBytes(version.dataUrl) });
    if (p.semitones % 12 !== 0) untransposed.push(p.song.title);
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
  chartStanzas(p.song.chordpro, p.semitones).forEach((stanza, i) => {
    if (i > 0) ctx.y -= 9;
    for (const line of stanza) {
      if (line.isDirective) continue;
      if (line.isSection) {
        ensureRoom(ctx, 40);
        ctx.y -= 16;
        drawText(ctx, line.lyric.toUpperCase(), MARGIN, 9.5, ctx.bold, MUTED);
        ctx.y -= 2;
        continue;
      }
      for (const piece of wrapLine(ctx, line, maxWidth)) drawChartLine(ctx, piece.lyric, piece.chords, includeChords);
    }
  });
}

/** Loads an image through an <img> (which applies EXIF rotation) and
 * re-encodes it as a JPEG no bigger than print needs. */
async function imageToJpeg(dataUrl: string): Promise<Uint8Array> {
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
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Places images one per page under the song header, scaled to fit. */
async function drawImagePages(ctx: PdfCtx, p: PlannedSong, jpegs: Uint8Array[]) {
  for (let i = 0; i < jpegs.length; i++) {
    newPage(ctx);
    if (i === 0) songHeader(ctx, p);
    const img = await ctx.doc.embedJpg(jpegs[i]);
    const maxW = ctx.size[0] - MARGIN * 2;
    const maxH = ctx.y - MARGIN;
    const s = Math.min(maxW / img.width, maxH / img.height, 1.5);
    const w = img.width * s;
    const h = img.height * s;
    ctx.page!.drawImage(img, { x: MARGIN + (maxW - w) / 2, y: ctx.y - h, width: w, height: h });
  }
  ctx.page = null; // the next song starts on a fresh page
}

/** Engraves a MusicXML score with OSMD in the slot's key, one SVG per
 * printed page, and rasterizes each page for embedding. */
async function renderScorePages(dataUrl: string, semitones: number, pageFormat: string): Promise<Uint8Array[]> {
  const { OpenSheetMusicDisplay, TransposeCalculator } = await import("opensheetmusicdisplay");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;background:#fff";
  document.body.appendChild(host);
  try {
    const osmd = new OpenSheetMusicDisplay(host, {
      backend: "svg",
      autoResize: false,
      pageFormat,
      pageBackgroundColor: "#FFFFFF",
      // The song header above the score already carries the title.
      drawTitle: false,
      drawPartNames: true,
      disableCursor: true,
    });
    osmd.TransposeCalculator = new TransposeCalculator();
    await osmd.load(await (await fetch(dataUrl)).blob());
    osmd.Sheet.Transpose = semitones;
    osmd.render();
    const out: Uint8Array[] = [];
    for (const svg of Array.from(host.querySelectorAll("svg"))) {
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
        const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.92));
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

  const songs = plan.filter((p) => p.view);
  for (let i = 0; i < songs.length; i++) {
    const p = songs[i];
    onProgress(`Adding ${p.song.title}`, i / songs.length);
    if (p.view === "chords") {
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
      ctx.page = null;
    } else if (p.view === "image") {
      await drawImagePages(ctx, p, [await imageToJpeg(selectedVersion(p.song.attachments.image!).dataUrl)]);
    } else if (p.view === "musicxml") {
      const pages = await renderScorePages(selectedVersion(p.song.attachments.musicxml!).dataUrl, p.semitones, letter ? "Letter_P" : "A4_P");
      await drawImagePages(ctx, p, pages);
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
  return { name: `${exportFileBase(setlist)}.pdf`, mime: "application/pdf", bytes, pages: total };
}
