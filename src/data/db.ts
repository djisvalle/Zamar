import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from "@capacitor-community/sqlite";

const DB_NAME = "zamar";
const DB_VERSION = 2;

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

// v2 — the single-slot attachment_* columns become one JSON column holding
// the new multi-category, multi-version shape (see
// docs/superpowers/specs/2026-09-20-attachment-categories-design.md).
const CREATE_SONGS = `CREATE TABLE IF NOT EXISTS songs (
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

const CREATE_SETTINGS = `CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  keepAwake INTEGER NOT NULL,
  autoscroll INTEGER NOT NULL,
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
      statements: [CREATE_SONGS_V1, CREATE_SETLISTS, CREATE_SECTIONS, CREATE_ITEMS, CREATE_SETTINGS],
    },
    {
      // No shipped install carries real data yet, so this drops and
      // recreates rather than migrating the old columns' contents — see the
      // comment above CREATE_SONGS.
      toVersion: 2,
      statements: ["DROP TABLE IF EXISTS songs;", CREATE_SONGS],
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
