// Dense vector search via sqlite-vec.
//
// sqlite-vec returns nearest neighbors by L2 distance. We want
// similarity in [0, 1] for fusion, so we convert with 1 / (1 + d).
// L2 distance in unit-norm embedding space is bounded, so this is a
// reasonable proxy for cosine similarity at retrieval fusion time.
//
// sqlite-vec requires the LIMIT to be a literal (not a parameter)
// on KNN queries, and the MATCH must be against the vec0 table
// directly. We do the KNN first, then JOIN to chunks for metadata,
// and filter by repo_id in the JOIN WHERE.

import { db, packEmbedding } from "../db/client";
import type { BM25Hit } from "./bm25";

export interface VectorHit extends BM25Hit {
  score: number; // similarity in [0, 1]
}

export function vectorSearch(embedding: number[], opts: { repoId?: string; k?: number } = {}): VectorHit[] {
  const k = opts.k ?? 20;
  // sqlite-vec requires the LIMIT to be a literal (not a parameter)
  // on KNN queries. We interpolate it directly. k is bounded by the
  // caller's validation, so this is safe.
  const limitSql = `LIMIT ${Math.max(1, Math.min(1000, Math.floor(k)))}`;
  const conn = db();
  const params: unknown[] = [packEmbedding(embedding)];

  // If a repo filter is requested, we over-fetch from the vec0
  // table (k * 4 with a cap of 200) and filter in the JOIN WHERE.
  // This is the standard sqlite-vec pattern when JOINs are involved.
  const vecLimit = opts.repoId
    ? `LIMIT ${Math.max(10, Math.min(200, Math.floor(k) * 4))}`
    : limitSql;

  const repoFilter = opts.repoId ? "WHERE c.repo_id = ?" : "";
  if (opts.repoId) params.push(opts.repoId);

  // Final LIMIT is a literal too, to satisfy sqlite-vec's parser.
  const finalLimit = `LIMIT ${Math.max(1, Math.min(1000, Math.floor(k)))}`;

  const sql = `
    SELECT
      v.chunk_id,
      v.distance,
      c.repo_id,
      c.file_id,
      c.path,
      c.start_line,
      c.end_line,
      c.kind,
      c.symbol,
      c.text
    FROM (
      SELECT chunk_id, distance
      FROM chunks_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      ${vecLimit}
    ) v
    JOIN chunks c ON c.id = v.chunk_id
    ${repoFilter}
    ORDER BY v.distance ASC
    ${finalLimit}
  `;
  const rows = conn.prepare(sql).all(...params) as Array<{
    chunk_id: string;
    distance: number;
    repo_id: string;
    file_id: string;
    path: string;
    start_line: number;
    end_line: number;
    kind: string;
    symbol: string | null;
    text: string;
  }>;
  return rows.map((r) => ({
    chunk_id: r.chunk_id,
    repo_id: r.repo_id,
    file_id: r.file_id,
    path: r.path,
    start_line: r.start_line,
    end_line: r.end_line,
    kind: r.kind,
    symbol: r.symbol,
    text: r.text,
    score: 1 / (1 + r.distance),
  }));
}