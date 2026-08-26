import { getDb } from "./db";
import type { Settings } from "../state/types";

interface SettingsRow {
  keepAwake: number;
  autoscroll: number;
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
    keepAwake: row.keepAwake === 1,
    autoscroll: row.autoscroll === 1,
    theme: row.theme as Settings["theme"],
    textScale: row.textScale,
    hasSeeded: row.hasSeeded === 1,
    micPermissionAsked: row.micPermissionAsked === 1,
  };
}

export async function replaceAll(settings: Settings): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO settings (id, keepAwake, autoscroll, theme, textScale, hasSeeded, micPermissionAsked)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       keepAwake = excluded.keepAwake,
       autoscroll = excluded.autoscroll,
       theme = excluded.theme,
       textScale = excluded.textScale,
       hasSeeded = excluded.hasSeeded,
       micPermissionAsked = excluded.micPermissionAsked`,
    [
      settings.keepAwake ? 1 : 0,
      settings.autoscroll ? 1 : 0,
      settings.theme,
      settings.textScale,
      settings.hasSeeded ? 1 : 0,
      settings.micPermissionAsked ? 1 : 0,
    ]
  );
}
