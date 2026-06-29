// SQLite + sqlite-vec singleton. One process, one connection.
// We load sqlite-vec as a loadable extension via the better-sqlite3
// `loadExtension` API. The extension ships in the `sqlite-vec` npm
// package and is platform-specific; the path resolver handles all
// three OSes.
//
// We deliberately keep this module thin. All schema lives in
// schema.sql and all migrations in migrate.ts. This file is the
// only place that touches better-sqlite3 directly.

import Database, { type Database as DB } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(HERE, "schema.sql");

let _db: DB | null = null;

export function db(): DB {
  if (_db) return _db;
  _db = open();
  return _db;
}

function open(): DB {
  const path = process.env.DB_PATH ?? "./data/code-doc.db";
  mkdirSync(dirname(path), { recursive: true });

  const conn = new Database(path);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");

  // sqlite-vec ships its loadable extension under
  // node_modules/sqlite-vec/dist/vec0.<so|dll|dylib>. The package
  // exposes a `getLoadablePath()` helper that returns the right
  // platform path.
  const vecPath = (sqliteVec as { getLoadablePath?: () => string }).getLoadablePath?.()
    ?? (sqliteVec as unknown as { default?: { getLoadablePath?: () => string } }).default?.getLoadablePath?.();
  if (!vecPath) {
    throw new Error("sqlite-vec: cannot resolve loadable extension path");
  }
  conn.loadExtension(vecPath);

  applySchema(conn);
  return conn;
}

function applySchema(conn: DB): void {
  const sql = readFileSync(SCHEMA_PATH, "utf8");
  conn.exec(sql);
}

// Helper: pack a float array into a Buffer for sqlite-vec.
// sqlite-vec expects little-endian float32.
export function packEmbedding(arr: number[]): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) buf.writeFloatLE(arr[i], i * 4);
  return buf;
}

// Helper: unpack. Mostly for tests.
export function unpackEmbedding(buf: Buffer): number[] {
  const out = new Array<number>(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

// Helper: dimension. Pulled from env, default 1536.
export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM ?? 1536);

// Initialize the vec0 virtual table for chunks. Idempotent.
// Called on first ingest. We keep it separate because we need the
// exact dimension at CREATE time.
export function ensureVecTable(dim: number = EMBEDDING_DIM): void {
  const conn = db();
  const row = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_vec'")
    .get();
  if (row) return;
  conn.exec(`CREATE VIRTUAL TABLE chunks_vec USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[${dim}]);`);
}

// Close on process exit. Next.js dev server hot-reloads; without this
// the SQLite handle leaks.
process.on("exit", () => {
  if (_db) try { _db.close(); } catch {}
});