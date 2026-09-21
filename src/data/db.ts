import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from "@capacitor-community/sqlite";

const DB_NAME = "zamar";
const DB_VERSION = 5;

// v1 shape — kept only so `addUpgradeStatement`'s v1 step still creates the
// original schema for a from-scratch install running the full upgrade
// chain (0 -> 1 -> 2); v2 below immediately replaces it.
const CREATE_SONGS_V1 = `CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  defaultKey TEXT NOT NULL,
  tempo INTEGER NOT NULL,
  timeSig TEXT NOT NULL,
  durationSec INTEGER NOT NULL,
  favourite INTEGER NOT NULL,
  source TEXT NOT NULL,
  chordpro TEXT NOT NULL,
  chartFormat TEXT NOT NULL,
  attachment_kind TEXT,
  attachment_role TEXT,
  attachment_dataUrl TEXT,
  attachment_name TEXT
);`;

// v2 shape — kept only so `addUpgradeStatement`'s v2 step still creates the
// table exactly as v2 actually had it (single-slot attachment_* columns
// replaced by one JSON column holding the multi-category, multi-version
// shape — see docs/superpowers/specs/2026-09-20-attachment-categories-design.md)
// for a from-scratch install running the full upgrade chain (0 -> 1 -> 2 -> 3);
// v3's ALTER TABLE statements below immediately add the notes/annotations
// columns on top of this. Frozen at this shape for the same reason
// CREATE_SONGS_V1 is frozen above: it must stay exactly what v2 created, or a
// fresh install's v3 step tries to add columns that already exist.
const CREATE_SONGS_V2 = `CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  defaultKey TEXT NOT NULL,
  tempo INTEGER NOT NULL,
  timeSig TEXT NOT NULL,
  durationSec INTEGER NOT NULL,
  favourite INTEGER NOT NULL,
  source TEXT NOT NULL,
  chordpro TEXT NOT NULL,
  chartFormat TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '{}'
);`;

const CREATE_SETLISTS = `CREATE TABLE IF NOT EXISTS setlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL
);`;

const CREATE_SECTIONS = `CREATE TABLE IF NOT EXISTS setlist_sections (
  id TEXT PRIMARY KEY,
  setlist_id TEXT NOT NULL REFERENCES setlists(id),
  label TEXT NOT NULL,
  position INTEGER NOT NULL
);`;

const CREATE_ITEMS = `CREATE TABLE IF NOT EXISTS setlist_items (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES setlist_sections(id),
  kind TEXT NOT NULL,
  song_id TEXT REFERENCES songs(id),
  label TEXT,
  keyOverride TEXT,
  capo INTEGER,
  note TEXT,
  position INTEGER NOT NULL
);`;

// v1 shape — kept only so `addUpgradeStatement`'s v1 step still creates the
// original schema (with the never-wired keepAwake/autoscroll columns) for a
// from-scratch install running the full upgrade chain; v4 below drops them.
const CREATE_SETTINGS_V1 = `CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  keepAwake INTEGER NOT NULL,
  autoscroll INTEGER NOT NULL,
  theme TEXT NOT NULL,
  textScale INTEGER NOT NULL,
  hasSeeded INTEGER NOT NULL,
  micPermissionAsked INTEGER NOT NULL
);`;

const CREATE_SETTINGS_V4 = `CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  theme TEXT NOT NULL,
  textScale INTEGER NOT NULL,
  hasSeeded INTEGER NOT NULL,
  micPermissionAsked INTEGER NOT NULL
);`;

const sqlite = new SQLiteConnection(CapacitorSQLite);
let dbPromise: Promise<SQLiteDBConnection> | null = null;

async function initWebStoreIfNeeded(): Promise<void> {
  if (Capacitor.getPlatform() !== "web") return;
  await customElements.whenDefined("jeep-sqlite");
  if (!document.querySelector("jeep-sqlite")) {
    document.body.appendChild(document.createElement("jeep-sqlite"));
    await customElements.whenDefined("jeep-sqlite");
  }
  await sqlite.initWebStore();
}

async function openDb(): Promise<SQLiteDBConnection> {
  await initWebStoreIfNeeded();

  await sqlite.addUpgradeStatement(DB_NAME, [
    {
      toVersion: 1,
      statements: [CREATE_SONGS_V1, CREATE_SETLISTS, CREATE_SECTIONS, CREATE_ITEMS, CREATE_SETTINGS_V1],
    },
    {
      // No shipped install carries real data yet, so this drops and
      // recreates rather than migrating the old columns' contents — see the
      // comment above CREATE_SONGS_V2.
      toVersion: 2,
      statements: ["DROP TABLE IF EXISTS songs;", CREATE_SONGS_V2, "DELETE FROM setlist_items;"],
    },
    {
      // Additive columns on an existing table — unlike the v1->v2 change,
      // there's real local data worth preserving by this point, so this
      // uses ALTER TABLE instead of dropping and recreating the table.
      toVersion: 3,
      statements: [
        "ALTER TABLE songs ADD COLUMN notes TEXT NOT NULL DEFAULT '';",
        "ALTER TABLE songs ADD COLUMN annotations_json TEXT NOT NULL DEFAULT '{}';",
      ],
    },
    {
      // keepAwake/autoscroll were never wired to real behavior (no Wake Lock
      // call, no scroll timer) and are being removed rather than implemented.
      // No shipped install carries real settings data yet, so this drops and
      // recreates rather than migrating around the removed columns (same
      // call as the v1->v2 songs change above).
      toVersion: 4,
      statements: ["DROP TABLE IF EXISTS settings;", CREATE_SETTINGS_V4],
    },
    {
      // Additive column — a song can now remember which view (chords, or a
      // specific attachment kind) Live Stage should open it to by default,
      // set from Add/Edit Song. NULL means "no preference saved," which is
      // every song that existed before this column, so no backfill of
      // existing rows is needed.
      toVersion: 5,
      statements: ["ALTER TABLE songs ADD COLUMN defaultView TEXT;"],
    },
  ]);

  const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
  const db = isConn
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, "no-encryption", DB_VERSION, false);

  await db.open();
  return db;
}

export function getDb(): Promise<SQLiteDBConnection> {
  if (!dbPromise) {
    dbPromise = openDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function persist(): Promise<void> {
  if (Capacitor.getPlatform() !== "web") return;
  await sqlite.saveToStore(DB_NAME);
}
