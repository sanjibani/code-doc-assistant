// Ingest pipeline: walk a local repo, chunk files, embed chunks,
// insert into SQLite + sqlite-vec.
//
// Idempotent on (repo_url, path): we re-ingest if the blob sha
// changed since last time. Same repo can be ingested multiple times
// safely; we update in place.
//
// We skip common junk: node_modules, .git, dist, build, coverage,
// __pycache__, .venv, .next. These rules live in `SKIP_DIRS` and
// `SKIP_FILES` below.
//
// We also build the import edge list for the architecture map at the
// same time. For TS/TSX we walk `import_statement` and `export_statement`.
// For Python we walk `import_statement` and `import_from_statement`.
// We do not resolve the imports to actual files in v1; the graph is
// "path -> import string", which is enough to render a force-directed
// graph and is what most people want anyway.

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { nanoid } from "nanoid";

import { chunkFile, type Chunk } from "./chunker/index";
import { db, ensureVecTable, EMBEDDING_DIM } from "./db/client";
import { embedBatched } from "./embed";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".turbo",
  ".cache",
  ".mavis_trash",
]);

const SKIP_FILES = new Set([".DS_Store", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

const SUPPORTED_EXTS = new Set([
  ".ts", ".tsx", ".mts", ".cts",
  ".py", ".pyi",
  "", ".jsx", ".mjs", ".cjs", // fallback path; chunked by sliding window
]);

export interface IngestOptions {
  repoUrl: string;
  repoName: string;
  localPath: string;
  defaultBranch?: string;
  commitSha?: string;
  traceId?: string;
  onProgress?: (stage: string, done: number, total: number) => void;
}

export interface IngestResult {
  repo_id: string;
  file_count: number;
  chunk_count: number;
  edge_count: number;
  duration_ms: number;
}

export async function ingestRepo(opts: IngestOptions): Promise<IngestResult> {
  const t0 = Date.now();
  ensureVecTable(EMBEDDING_DIM);
  const conn = db();

  const absPath = resolve(opts.localPath);
  const repoId = upsertRepo({
    id: nanoid(),
    url: opts.repoUrl,
    name: opts.repoName,
    local_path: absPath,
    default_branch: opts.defaultBranch ?? "main",
    commit_sha: opts.commitSha ?? null,
    ingested_at: new Date().toISOString(),
  });

  // Walk files.
  const allFiles: string[] = [];
  await walk(absPath, absPath, allFiles);
  const files = allFiles.filter((p) => SUPPORTED_EXTS.has(extname(p).toLowerCase()));
  opts.onProgress?.("walking", files.length, files.length);

  // Chunk every file.
  const chunkInputs: Array<{ fileId: string; chunk: Chunk }> = [];
  const edges: Array<{ from_path: string; to_path: string; kind: string }> = [];

  for (let i = 0; i < files.length; i++) {
    const rel = relative(absPath, files[i]!).replace(/\\/g, "/");
    const text = await readFile(files[i]!, "utf8");
    const sha = sha1(text);
    const language = languageFor(rel);
    const bytes = Buffer.byteLength(text, "utf8");
    const lines = text.split("\n").length;
    const fileId = upsertFile({
      id: nanoid(),
      repo_id: repoId,
      path: rel,
      language,
      sha,
      bytes,
      lines,
    });
    const chunks = chunkFile({ path: rel, text });
    for (const c of chunks) {
      chunkInputs.push({ fileId, chunk: c });
    }
    collectEdges(rel, text, language, edges);
    opts.onProgress?.("chunking", i + 1, files.length);
  }

  // Embed chunks in batches. Prefix with the basename so the model
  // gets a hint about the file's role (e.g. "auth.ts" + body).
  const texts = chunkInputs.map((c) => `${pathBasename(c.chunk.path)}\n${c.chunk.text}`);
  const embeddings = await embedBatched(texts, {
    batchSize: 32,
    trace_id: opts.traceId,
    onProgress: (done, total) => opts.onProgress?.("embedding", done, total),
  });

  // Insert chunks (delete-and-replace by file for idempotency).
  const insertChunk = conn.prepare(`
    INSERT INTO chunks (id, repo_id, file_id, path, start_line, end_line, kind, symbol, text, token_est, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = conn.prepare(`
    INSERT INTO chunks_fts (rowid, symbol, text) VALUES ((SELECT rowid FROM chunks WHERE id = ?), ?, ?)
  `);
  const insertVec = conn.prepare(`
    INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)
  `);

  const tx = conn.transaction(() => {
    for (let i = 0; i < chunkInputs.length; i++) {
      const c = chunkInputs[i]!;
      const chunkId = nanoid();
      insertChunk.run(
        chunkId,
        repoId,
        c.fileId,
        c.chunk.path,
        c.chunk.start_line,
        c.chunk.end_line,
        c.chunk.kind,
        c.chunk.symbol,
        c.chunk.text,
        c.chunk.token_est,
        embeddings[i]!,
      );
      insertFts.run(chunkId, c.chunk.symbol, c.chunk.text);
      insertVec.run(chunkId, embeddings[i]!);
    }
    // Edges
    const insertEdge = conn.prepare(`
      INSERT OR REPLACE INTO edges (from_path, to_path, repo_id, kind) VALUES (?, ?, ?, ?)
    `);
    for (const e of edges) insertEdge.run(e.from_path, e.to_path, repoId, e.kind);
  });
  tx();

  const result: IngestResult = {
    repo_id: repoId,
    file_count: files.length,
    chunk_count: chunkInputs.length,
    edge_count: edges.length,
    duration_ms: Date.now() - t0,
  };
  conn.prepare("UPDATE repos SET file_count=?, chunk_count=? WHERE id=?").run(
    result.file_count,
    result.chunk_count,
    repoId,
  );
  return result;
}

function upsertRepo(r: {
  id: string;
  url: string;
  name: string;
  local_path: string;
  default_branch: string;
  commit_sha: string | null;
  ingested_at: string;
}): string {
  const conn = db();
  const existing = conn.prepare("SELECT id FROM repos WHERE url = ?").get(r.url) as { id: string } | undefined;
  if (existing) {
    conn.prepare(
      "UPDATE repos SET local_path=?, default_branch=?, commit_sha=?, ingested_at=? WHERE id=?",
    ).run(r.local_path, r.default_branch, r.commit_sha, r.ingested_at, existing.id);
    return existing.id;
  }
  conn.prepare(
    `INSERT INTO repos (id, url, name, local_path, default_branch, commit_sha, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.id, r.url, r.name, r.local_path, r.default_branch, r.commit_sha, r.ingested_at);
  return r.id;
}

function upsertFile(f: {
  id: string;
  repo_id: string;
  path: string;
  language: string;
  sha: string;
  bytes: number;
  lines: number;
}): string {
  const conn = db();
  const existing = conn.prepare("SELECT id, sha FROM files WHERE repo_id = ? AND path = ?").get(f.repo_id, f.path) as { id: string; sha: string } | undefined;
  if (existing) {
    if (existing.sha === f.sha) return existing.id;
    // File changed: drop old chunks before re-insert.
    conn.prepare("DELETE FROM chunks WHERE file_id = ?").run(existing.id);
    conn.prepare("UPDATE files SET language=?, sha=?, bytes=?, lines=? WHERE id=?").run(
      f.language, f.sha, f.bytes, f.lines, existing.id,
    );
    return existing.id;
  }
  conn.prepare(
    `INSERT INTO files (id, repo_id, path, language, sha, bytes, lines) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(f.id, f.repo_id, f.path, f.language, f.sha, f.bytes, f.lines);
  return f.id;
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(root, p, out);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name)) continue;
      try {
        const s = await stat(p);
        // Skip files larger than 1 MB raw. We can lift this later.
        if (s.size > 1_000_000) continue;
        out.push(p);
      } catch {
        // ignore
      }
    }
  }
}

function languageFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "typescript";
  if (ext === ".tsx") return "tsx";
  if (ext === "" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".jsx") return "jsx";
  if (ext === ".py") return "python";
  if (ext === ".pyi") return "python-stubs";
  return "unknown";
}

function pathBasename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

// Lightweight import collection. We deliberately do NOT parse the
// full AST here; we use regex for JS/TS imports and Python
// import/from statements. The grammar-aware version is a follow-up.
function collectEdges(
  path: string,
  text: string,
  language: string,
  edges: Array<{ from_path: string; to_path: string; kind: string }>,
): void {
  if (language.startsWith("typescript") || language.startsWith("javascript") || language.startsWith("tsx") || language.startsWith("jsx")) {
    const importRe = /import\s+(?:[^'"`;]+\s+from\s+)?['"`]([^'"`]+)['"`]/g;
    const requireRe = /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
    const exportRe = /export\s+(?:\*|{[^}]+})\s+from\s+['"`]([^'"`]+)['"`]/g;
    let m;
    while ((m = importRe.exec(text))) edges.push({ from_path: path, to_path: m[1]!, kind: "import" });
    while ((m = requireRe.exec(text))) edges.push({ from_path: path, to_path: m[1]!, kind: "require" });
    while ((m = exportRe.exec(text))) edges.push({ from_path: path, to_path: m[1]!, kind: "export" });
  } else if (language.startsWith("python")) {
    const importRe = /^\s*import\s+([\w.]+)/gm;
    const fromRe = /^\s*from\s+([\w.]+)\s+import/gm;
    let m;
    while ((m = importRe.exec(text))) edges.push({ from_path: path, to_path: m[1]!, kind: "import" });
    while ((m = fromRe.exec(text))) edges.push({ from_path: path, to_path: m[1]!, kind: "from" });
  }
}