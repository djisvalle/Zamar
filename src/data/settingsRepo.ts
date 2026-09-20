import { getDb } from "./db";
import type { Settings } from "../state/types";

interface SettingsRow {
  theme: string;
  textScale: number;
  hasSeeded: number;
  micPermissionAsked: number;
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
  };
}

export function buildUpsertStatement(settings: Settings): { statement: string; values: unknown[] } {
  return {
    statement: `INSERT INTO settings (id, theme, textScale, hasSeeded, micPermissionAsked)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       theme = excluded.theme,
       textScale = excluded.textScale,
       hasSeeded = excluded.hasSeeded,
       micPermissionAsked = excluded.micPermissionAsked`,
    values: [settings.theme, settings.textScale, settings.hasSeeded ? 1 : 0, settings.micPermissionAsked ? 1 : 0],
  };
}

export async function replaceAll(settings: Settings): Promise<void> {
  const db = await getDb();
  const { statement, values } = buildUpsertStatement(settings);
  await db.run(statement, values);
}
