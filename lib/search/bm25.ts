// BM25 search via SQLite FTS5.
//
// We query chunks_fts and join back to chunks for full metadata. We
// use the bm25() ranking function. Negative bm25 is better.
//
// We accept a query string and an optional repo_id filter. If you pass
// repo_id=null we search all repos (cross-repo retrieval is out of
// scope for v1 but the schema supports it).

import { db } from "../db/client";

export interface BM25Hit {
  chunk_id: string;
  repo_id: string;
  file_id: string;
  path: string;
  start_line: number;
  end_line: number;
  kind: string;
  symbol: string | null;
  text: string;
  score: number; // bm25 score (negative, lower is better; we negate for fusion)
}

export function bm25Search(query: string, opts: { repoId?: string; k?: number } = {}): BM25Hit[] {
  const k = opts.k ?? 20;
  const ftsQuery = sanitize(query);
  if (!ftsQuery) return [];

  const conn = db();
  // Pull top-k from FTS, join to chunks for metadata. We only want
  // chunks that have a non-empty embedding too so fusion has both
  // legs to work with. Implemented as a subquery.
  const params: unknown[] = [ftsQuery];
  let sql = `
    SELECT
      c.id AS chunk_id,
      c.repo_id,
      c.file_id,
      c.path,
      c.start_line,
      c.end_line,
      c.kind,
      c.symbol,
      c.text,
      bm25(chunks_fts) AS score
    FROM chunks_fts
    JOIN chunks c ON c.rowid = chunks_fts.rowid
    WHERE chunks_fts MATCH ?
  `;
  if (opts.repoId) {
    sql += " AND c.repo_id = ?";
    params.push(opts.repoId);
  }
  sql += " ORDER BY score ASC LIMIT ?";
  params.push(k);

  const rows = conn.prepare(sql).all(...params) as Array<{
    chunk_id: string;
    repo_id: string;
    file_id: string;
    path: string;
    start_line: number;
    end_line: number;
    kind: string;
    symbol: string | null;
    text: string;
    score: number;
  }>;
  return rows.map((r) => ({ ...r, score: -r.score }));
}

// Sanitize a user question into an FTS5 query string. We strip
// punctuation that FTS5 treats as operators, escape double-quotes,
// and add a prefix-match wildcard on the last term so partial words
// match (e.g. "auth" -> "auth*").
function sanitize(q: string): string {
  const tokens = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return "";
  const last = tokens.pop()!;
  return [...tokens.map((t) => `"${t.replace(/"/g, '""')}"`), `"${last.replace(/"/g, '""')}"*`].join(" ");
}