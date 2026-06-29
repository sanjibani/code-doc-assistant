-- Code Documentation Assistant schema
-- One database, many repos. Each repo can be ingested multiple times.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- A repo we have ingested. `url` is the canonical source location
-- (e.g. https://github.com/denoland/fresh). `local_path` is where the
-- original source sits on disk for line-accurate citations.
CREATE TABLE IF NOT EXISTS repos (
  id           TEXT PRIMARY KEY,             -- nanoid
  url          TEXT NOT NULL UNIQUE,         -- canonical remote URL
  name         TEXT NOT NULL,                -- short label, e.g. "fresh"
  local_path   TEXT NOT NULL,                -- absolute path on disk
  default_branch TEXT NOT NULL DEFAULT 'main',
  commit_sha   TEXT,                          -- HEAD at ingest time
  ingested_at  TEXT NOT NULL,                -- ISO8601
  file_count   INTEGER NOT NULL DEFAULT 0,
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  embedding_dim INTEGER NOT NULL DEFAULT 1536
);

-- One row per source file we have seen. `language` drives which
-- tree-sitter grammar we use at chunk time. `sha` is the blob hash
-- at ingest time so we can decide on re-ingest whether the file changed.
CREATE TABLE IF NOT EXISTS files (
  id           TEXT PRIMARY KEY,
  repo_id      TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,                -- repo-relative path
  language     TEXT NOT NULL,                -- 'typescript' | 'python' | ...
  sha          TEXT NOT NULL,                -- blob sha at ingest
  bytes        INTEGER NOT NULL,
  lines        INTEGER NOT NULL,
  UNIQUE (repo_id, path)
);
CREATE INDEX IF NOT EXISTS idx_files_repo ON files(repo_id);

-- A chunk is the unit of retrieval. It is one AST node plus a few
-- overlapping lines on either side so cross-node queries still work.
-- `kind` is the AST node type (function_declaration, class_definition, ...).
-- `symbol` is the best-effort human label (function name, class name).
CREATE TABLE IF NOT EXISTS chunks (
  id           TEXT PRIMARY KEY,             -- nanoid
  repo_id      TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,                -- denormalized for fast cite
  start_line   INTEGER NOT NULL,
  end_line     INTEGER NOT NULL,
  kind         TEXT NOT NULL,                -- 'function' | 'class' | 'method' | ...
  symbol       TEXT,                         -- name if available
  text         TEXT NOT NULL,                -- the chunk content
  token_est    INTEGER NOT NULL,             -- rough token count
  embedding    BLOB                          -- packed float32 array, length = embedding_dim * 4
);
CREATE INDEX IF NOT EXISTS idx_chunks_repo_file ON chunks(repo_id, file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_symbol ON chunks(symbol);

-- SQLite FTS5 over chunks. We use porter stemming for English-friendly
-- recall and unicode61 for token splitting. `content_rowid` is implicit
-- because we declared `content='chunks'`. We materialize only what
-- matters for search; the full text lives in chunks.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  symbol,
  text,
  content='chunks',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- sqlite-vec virtual table for dense retrieval. The dimension must match
-- the embedding model. We default to 1536 (MiniMax text-embedding-3-small
-- equivalent). We store the row id and let sqlite-vec map float arrays.
-- We have to register sqlite-vec as a loadable extension at connection
-- time. See lib/db/client.ts.
-- Note: the column name MUST be `embedding` of type float[N]. The number
-- is the dimension at table creation time. If you change the model, drop
-- this table and recreate it with the new dim.

-- Edge list for the architecture map. Built at ingest time by walking
-- imports. Two layers: source -> source (within repo), source -> external.
CREATE TABLE IF NOT EXISTS edges (
  from_path    TEXT NOT NULL,
  to_path      TEXT NOT NULL,                -- '.' means root / external
  repo_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,                -- 'import' | 'require' | 'from'
  PRIMARY KEY (repo_id, from_path, to_path)
);
CREATE INDEX IF NOT EXISTS idx_edges_repo ON edges(repo_id);

-- Eval run history. One row per `pnpm eval` invocation. Per-question
-- scores live in `eval_results`. We persist this so the README can
-- show a trend line over time.
CREATE TABLE IF NOT EXISTS eval_runs (
  id           TEXT PRIMARY KEY,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  total        INTEGER NOT NULL,
  passed       INTEGER NOT NULL,
  recall_at_5  REAL,
  cite_rate    REAL
);

CREATE TABLE IF NOT EXISTS eval_results (
  run_id       TEXT NOT NULL,
  question     TEXT NOT NULL,
  expected_paths TEXT NOT NULL,               -- JSON array
  retrieved_paths TEXT NOT NULL,             -- JSON array
  cited        INTEGER NOT NULL,              -- 0/1: did answer include citation?
  recall_at_5  REAL NOT NULL,
  PRIMARY KEY (run_id, question)
);
CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results(run_id);