// Migration runner. Currently a no-op because we apply schema.sql at
// open time. Kept as a separate module so future schema bumps have a
// clear home. We use a tiny version table; bump VERSION when schema
// changes and add the ALTER block to MIGRATIONS.

import { db } from "./client";

const VERSION = 1;
const MIGRATIONS: Array<(d: number) => void> = [
  // v1 is the initial schema; no-op.
  () => {},
];

export function migrate(): void {
  const conn = db();
  conn.exec(
    `CREATE TABLE IF NOT EXISTS schema_version (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL
     )`,
  );
  const row = conn.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
  const current = row.v ?? 0;
  for (let v = current + 1; v <= VERSION; v++) {
    const fn = MIGRATIONS[v - 1];
    if (fn) fn(v);
    conn.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
      v,
      new Date().toISOString(),
    );
  }
}