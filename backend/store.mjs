import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const env = globalThis.process?.env ?? {};
const DEFAULT_SQLITE_FILE = fileURLToPath(new URL("./data/store.sqlite", import.meta.url));
const DEFAULT_LEGACY_STORE_FILE = fileURLToPath(new URL("./data/store.json", import.meta.url));
const SQLITE_FILE = resolveDataPath(env.SQLITE_FILE || env.STORE_DB_FILE || DEFAULT_SQLITE_FILE);
const LEGACY_STORE_FILE = resolveDataPath(env.STORE_FILE || DEFAULT_LEGACY_STORE_FILE);

const EMPTY_STORE = {
  requests: [],
  translations: [],
  events: []
};

let db = null;

export async function loadStore() {
  const database = await getDatabase();
  return {
    requests: readPayloads(database, "translation_requests"),
    translations: readPayloads(database, "staged_translations"),
    events: readPayloads(database, "events")
  };
}

export async function saveStore(store) {
  const database = await getDatabase();
  writeStore(database, normalizeStore(store));
}

export function getStoreInfo() {
  return {
    type: "sqlite",
    sqliteFile: SQLITE_FILE,
    legacyStoreFile: LEGACY_STORE_FILE
  };
}

async function getDatabase() {
  if (db) {
    return db;
  }

  await mkdir(dirname(SQLITE_FILE), {
    recursive: true
  });

  db = new DatabaseSync(SQLITE_FILE);
  initializeDatabase(db);
  await migrateLegacyStoreIfNeeded(db);
  return db;
}

function initializeDatabase(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS translation_requests (
      id TEXT PRIMARY KEY,
      sku TEXT,
      source_locale TEXT,
      target_locale TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_translation_requests_sku
      ON translation_requests (sku);

    CREATE INDEX IF NOT EXISTS idx_translation_requests_status
      ON translation_requests (status);

    CREATE TABLE IF NOT EXISTS staged_translations (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      sku TEXT,
      target_locale TEXT,
      status TEXT,
      created_at TEXT,
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_staged_translations_lookup
      ON staged_translations (sku, target_locale);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      sku TEXT,
      target_locale TEXT,
      type TEXT,
      created_at TEXT,
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_request
      ON events (request_id);
  `);
}

async function migrateLegacyStoreIfNeeded(database) {
  if (!isDatabaseEmpty(database) || !existsSync(LEGACY_STORE_FILE)) {
    return;
  }

  const raw = stripBom(await readFile(LEGACY_STORE_FILE, "utf8"));
  const legacyStore = normalizeStore(JSON.parse(raw));
  writeStore(database, legacyStore);
}

function isDatabaseEmpty(database) {
  const requestCount = database
    .prepare("SELECT COUNT(*) AS count FROM translation_requests")
    .get().count;
  const translationCount = database
    .prepare("SELECT COUNT(*) AS count FROM staged_translations")
    .get().count;
  const eventCount = database.prepare("SELECT COUNT(*) AS count FROM events").get().count;

  return requestCount === 0 && translationCount === 0 && eventCount === 0;
}

function readPayloads(database, tableName) {
  return database
    .prepare(`SELECT payload FROM ${tableName} ORDER BY created_at ASC, id ASC`)
    .all()
    .map((row) => JSON.parse(row.payload));
}

function writeStore(database, store) {
  const insertRequest = database.prepare(`
    INSERT INTO translation_requests (
      id,
      sku,
      source_locale,
      target_locale,
      status,
      created_at,
      updated_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTranslation = database.prepare(`
    INSERT INTO staged_translations (
      id,
      request_id,
      sku,
      target_locale,
      status,
      created_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEvent = database.prepare(`
    INSERT INTO events (
      id,
      request_id,
      sku,
      target_locale,
      type,
      created_at,
      payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM events; DELETE FROM staged_translations; DELETE FROM translation_requests;");

    for (const request of store.requests) {
      insertRequest.run(
        request.id,
        request.sku || null,
        request.sourceLocale || null,
        request.targetLocale || null,
        request.status || null,
        request.createdAt || null,
        request.updatedAt || null,
        JSON.stringify(request)
      );
    }

    for (const translation of store.translations) {
      insertTranslation.run(
        translation.id,
        translation.requestId || null,
        translation.sku || null,
        translation.targetLocale || null,
        translation.status || null,
        translation.createdAt || null,
        JSON.stringify(translation)
      );
    }

    for (const event of store.events) {
      insertEvent.run(
        event.id,
        event.requestId || null,
        event.sku || null,
        event.targetLocale || null,
        event.type || null,
        event.createdAt || null,
        JSON.stringify(event)
      );
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function normalizeStore(store) {
  return {
    requests: Array.isArray(store?.requests) ? store.requests : EMPTY_STORE.requests,
    translations: Array.isArray(store?.translations)
      ? store.translations
      : EMPTY_STORE.translations,
    events: Array.isArray(store?.events) ? store.events : EMPTY_STORE.events
  };
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function resolveDataPath(value) {
  return isAbsolute(value) ? value : resolve(value);
}
