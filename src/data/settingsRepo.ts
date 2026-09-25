import { getDb } from "./db";
import type { AnnotateRecents, Settings } from "../state/types";

interface SettingsRow {
  theme: string;
  textScale: number;
  hasSeeded: number;
  micPermissionAsked: number;
  staveSpacing: string;
  annotateRecents_json: string;
  annotateSnap: number;
}

/** Reads the stored recents defensively: a missing or partial object (a row
 * written before a tool had a Recent row) fills in empty lists. */
function parseRecents(json: string | undefined): AnnotateRecents {
  let raw: Partial<AnnotateRecents> = {};
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    // Treat unreadable JSON as no recents rather than failing the whole load.
  }
  const list = <T,>(v: T[] | undefined) => (Array.isArray(v) ? v : []);
  return {
    pen: list(raw.pen),
    highlighter: list(raw.highlighter),
    text: list(raw.text),
    shapes: list(raw.shapes),
    notation: list(raw.notation),
  };
}

export async function loadAll(): Promise<Settings | null> {
  const db = await getDb();
  const result = await db.query("SELECT * FROM settings WHERE id = 1");
  const row = ((result.values ?? []) as SettingsRow[])[0];
  if (!row) return null;
  return {
    theme: row.theme as Settings["theme"],
    textScale: row.textScale,
    hasSeeded: row.hasSeeded === 1,
    micPermissionAsked: row.micPermissionAsked === 1,
    staveSpacing: row.staveSpacing as Settings["staveSpacing"],
    annotateRecents: parseRecents(row.annotateRecents_json),
    annotateSnap: row.annotateSnap !== 0,
  };
}

export function buildUpsertStatement(settings: Settings): { statement: string; values: unknown[] } {
  return {
    statement: `INSERT INTO settings (id, theme, textScale, hasSeeded, micPermissionAsked, staveSpacing, annotateRecents_json, annotateSnap)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       theme = excluded.theme,
       textScale = excluded.textScale,
       hasSeeded = excluded.hasSeeded,
       micPermissionAsked = excluded.micPermissionAsked,
       staveSpacing = excluded.staveSpacing,
       annotateRecents_json = excluded.annotateRecents_json,
       annotateSnap = excluded.annotateSnap`,
    values: [
      settings.theme,
      settings.textScale,
      settings.hasSeeded ? 1 : 0,
      settings.micPermissionAsked ? 1 : 0,
      settings.staveSpacing,
      JSON.stringify(settings.annotateRecents),
      settings.annotateSnap ? 1 : 0,
    ],
  };
}

export async function replaceAll(settings: Settings): Promise<void> {
  const db = await getDb();
  const { statement, values } = buildUpsertStatement(settings);
  await db.run(statement, values);
}
