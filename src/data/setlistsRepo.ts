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

export function buildDeleteStatements(): { statement: string; values: unknown[] }[] {
  return [
    { statement: "DELETE FROM setlist_items", values: [] },
    { statement: "DELETE FROM setlist_sections", values: [] },
    { statement: "DELETE FROM setlists", values: [] },
  ];
}

export function buildInsertStatements(setlists: Setlist[]): { statement: string; values: unknown[] }[] {
  const statements: { statement: string; values: unknown[] }[] = [];
  for (const sl of setlists) {
    statements.push({
      statement: "INSERT INTO setlists (id, name, date, time, description, status) VALUES (?, ?, ?, ?, ?, ?)",
      values: [sl.id, sl.name, sl.date, sl.time, sl.description, sl.status],
    });
    sl.sections.forEach((sec, secIdx) => {
      statements.push({
        statement: "INSERT INTO setlist_sections (id, setlist_id, label, position) VALUES (?, ?, ?, ?)",
        values: [sec.id, sl.id, sec.label, secIdx],
      });
      sec.items.forEach((item, itemIdx) => {
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
  }
  return statements;
}

export async function replaceAll(setlists: Setlist[]): Promise<void> {
  const db = await getDb();
  await db.executeSet([...buildDeleteStatements(), ...buildInsertStatements(setlists)]);
}
