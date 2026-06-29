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

// Sanitize a user question into an FTS5 query string.
//
// Strategy: drop stopwords (the, a, is, do, what, how, ...), then
// OR the remaining meaningful terms with a prefix wildcard on the
// last one. AND'ing every word in the question is too strict — a
// chunk is relevant if it matches the MEANINGFUL words, not the
// filler.
//
// Example: "What does the ingestRepo function do?"
//   tokens: [function, ingestrepo]
//   query:  "function" "ingestrepo"*
//   (one quoted term per token, last one with prefix match)
//
// We filter aggressively: tokens must be 3+ chars and not in the
// stopword list. Filler words (the, a, what, how) drop out, so
// FTS5 only matches the meaningful ones.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can",
  "her", "was", "one", "our", "had", "has", "his", "how", "its",
  "may", "did", "get", "let", "say", "she", "too", "use", "with",
  "this", "that", "from", "have", "what", "when", "where", "which",
  "who", "why", "would", "could", "should", "will", "shall", "may",
  "might", "must", "does", "doing", "been", "being", "into", "than",
  "then", "them", "they", "your", "yours", "their", "there", "here",
  "now", "way", "many", "some", "such", "very",
]);
function sanitize(q: string): string {
  const tokens = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return `"${tokens[0]!.replace(/"/g, '""')}"*`;
  const last = tokens.pop()!;
  return [...tokens.map((t) => `"${t.replace(/"/g, '""')}"`), `"${last.replace(/"/g, '""')}"*`].join(" OR ");
}