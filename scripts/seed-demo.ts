#!/usr/bin/env tsx
// Demo seeder. Inserts chunks for this project's own lib/ directory
// into the SQLite DB using deterministic fake embeddings so the UI
// can be screenshotted without a real MiniMax API key.
//
// This is NOT a real ingest. Real ingest goes through lib/ingest.ts
// with the MiniMax embeddings API. This file exists so the README
// can include screenshots of a populated UI.

import { chunkFile, type Chunk } from "../lib/chunker/index";
import { db, ensureVecTable, packEmbedding, EMBEDDING_DIM } from "../lib/db/client";
import { fakeEmbedForSeed } from "../lib/fake-embed";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { readdirSync } from "node:fs";

const REPO_URL = "demo://code-doc-assistant";
const REPO_NAME = "code-doc-assistant (demo)";
const REPO_PATH = join(process.cwd());

async function main(): Promise<void> {
  const conn = db();
  ensureVecTable(EMBEDDING_DIM);
  conn.exec("DELETE FROM repos WHERE url = ?");

  const repoId = "demo-repo";
  conn.prepare(
    `INSERT INTO repos (id, url, name, local_path, default_branch, commit_sha, ingested_at, file_count, chunk_count, embedding_dim)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    repoId, REPO_URL, REPO_NAME, REPO_PATH, "main", "demo-sha",
    new Date().toISOString(), 0, 0, EMBEDDING_DIM,
  );

  const libFiles = readdirSync(join(REPO_PATH, "lib"), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".ts"))
    .map((d) => join("lib", d.name));

  const insertFile = conn.prepare(
    `INSERT INTO files (id, repo_id, path, language, sha, bytes, lines) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertChunk = conn.prepare(
    `INSERT INTO chunks (id, repo_id, file_id, path, start_line, end_line, kind, symbol, text, token_est, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFts = conn.prepare(
    `INSERT INTO chunks_fts (rowid, symbol, text) VALUES ((SELECT rowid FROM chunks WHERE id = ?), ?, ?)`,
  );
  const insertVec = conn.prepare(
    `INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)`,
  );

  let fileCount = 0;
  let chunkCount = 0;
  for (const rel of libFiles) {
    const abs = join(REPO_PATH, rel);
    const text = await readFile(abs, "utf8");
    const fileId = `demo-file-${rel}`;
    insertFile.run(fileId, repoId, rel, "typescript", "demo", text.length, text.split("\n").length);
    const chunks: Chunk[] = chunkFile({ path: rel, text });
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const chunkId = `demo-${rel}-${i}`;
      // Deterministic fake embedding. Use the symbol so that queries
      // for that symbol match (assuming EMBED_FAKE=1 in env).
      const v = fakeEmbedForSeed(c.symbol ?? c.kind);
      const buf = packEmbedding(v);
      insertChunk.run(chunkId, repoId, fileId, rel, c.start_line, c.end_line, c.kind, c.symbol, c.text, c.token_est, buf);
      insertFts.run(chunkId, c.symbol, c.text);
      insertVec.run(chunkId, buf);
      chunkCount++;
    }
    fileCount++;
  }

  // Edges for the architecture map. We pretend every file imports every other.
  const insertEdge = conn.prepare(
    `INSERT INTO edges (from_path, to_path, repo_id, kind) VALUES (?, ?, ?, ?)`,
  );
  for (const a of libFiles) {
    for (const b of libFiles) {
      if (a !== b) insertEdge.run(a, b.replace(/^lib\//, ""), repoId, "import");
    }
  }

  conn.prepare("UPDATE repos SET file_count=?, chunk_count=? WHERE id=?").run(fileCount, chunkCount, repoId);

  console.error(`seeded demo: ${fileCount} files, ${chunkCount} chunks, ${libFiles.length * (libFiles.length - 1)} edges`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});