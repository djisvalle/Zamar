import { getDb } from "./db";
import type { Setlist, SetlistItem, SetlistSection } from "../state/types";

interface SetlistRow {
  id: string;
  name: string;
  date: string;
  time: string;
  description: string;
  status: string;
}
interface SectionRow {
  id: string;
  setlist_id: string;
  label: string;
  position: number;
}
interface ItemRow {
  id: string;
  section_id: string;
  kind: string;
  song_id: string | null;
  label: string | null;
  keyOverride: string | null;
  note: string | null;
  position: number;
}

export async function loadAll(): Promise<Setlist[]> {
  const db = await getDb();
  const [setlistsRes, sectionsRes, itemsRes] = await Promise.all([
    db.query("SELECT * FROM setlists"),
    db.query("SELECT * FROM setlist_sections ORDER BY position ASC"),
    db.query("SELECT * FROM setlist_items ORDER BY position ASC"),
  ]);
  const setlistRows = (setlistsRes.values ?? []) as SetlistRow[];
  const sectionRows = (sectionsRes.values ?? []) as SectionRow[];
  const itemRows = (itemsRes.values ?? []) as ItemRow[];

  return setlistRows.map((sl) => {
    const sections: SetlistSection[] = sectionRows
      .filter((sec) => sec.setlist_id === sl.id)
      .map((sec) => {
        const items: SetlistItem[] = itemRows
          .filter((it) => it.section_id === sec.id)
          .map((it) => {
            const item: SetlistItem = { id: it.id, kind: it.kind as SetlistItem["kind"] };
            if (it.song_id != null) item.songId = it.song_id;
            if (it.label != null) item.label = it.label;
            if (it.keyOverride != null) item.keyOverride = it.keyOverride;
            if (it.note != null) item.note = it.note;
            return item;
          });
        return { id: sec.id, label: sec.label, items };
      });
    return {
      id: sl.id,
      name: sl.name,
      date: sl.date,
      time: sl.time,
      description: sl.description,
      status: sl.status as Setlist["status"],
      sections,
    };
  });
}

type Statement = { statement: string; values: unknown[] };

/** Removes a setlist's sections and slots, and with `row` the setlist too. */
export function buildDeleteStatements(setlistId: string, row = true): Statement[] {
  const statements: Statement[] = [
    {
      statement: "DELETE FROM setlist_items WHERE section_id IN (SELECT id FROM setlist_sections WHERE setlist_id = ?)",
      values: [setlistId],
    },
    { statement: "DELETE FROM setlist_sections WHERE setlist_id = ?", values: [setlistId] },
  ];
  if (row) statements.push({ statement: "DELETE FROM setlists WHERE id = ?", values: [setlistId] });
  return statements;
}

/** Rewrites one setlist: clears its sections and slots, upserts its row and
 * inserts them again in order. A song slot whose song isn't in `songIds`
 * is left out, so the write can't break the setlist_items foreign key. */
export function buildWriteStatements(sl: Setlist, songIds: ReadonlySet<string>): Statement[] {
  const statements = buildDeleteStatements(sl.id, false);
  statements.push({
    statement: `INSERT INTO setlists (id, name, date, time, description, status) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, date = excluded.date, time = excluded.time,
        description = excluded.description, status = excluded.status`,
    values: [sl.id, sl.name, sl.date, sl.time, sl.description, sl.status],
  });
  sl.sections.forEach((sec, secIdx) => {
    statements.push({
      statement: "INSERT INTO setlist_sections (id, setlist_id, label, position) VALUES (?, ?, ?, ?)",
      values: [sec.id, sl.id, sec.label, secIdx],
    });
    sec.items.forEach((item, itemIdx) => {
      if (item.kind === "song" && (item.songId == null || !songIds.has(item.songId))) return;
      statements.push({
        statement: `INSERT INTO setlist_items
          (id, section_id, kind, song_id, label, keyOverride, note, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          item.id,
          sec.id,
          item.kind,
          item.songId ?? null,
          item.label ?? null,
          item.keyOverride ?? null,
          item.note ?? null,
          itemIdx,
        ],
      });
    });
  });
  return statements;
}
