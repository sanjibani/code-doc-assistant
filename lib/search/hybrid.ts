// Hybrid search: Reciprocal Rank Fusion (RRF) over BM25 + vector.
//
// RRF formula: fused(d) = sum( 1 / (k0 + rank_i(d)) )
// where rank_i(d) is the rank of document d in result list i (1-based).
// We use k0 = 60 (the value from the original RRF paper; it works).
//
// We deduplicate on chunk_id, keep the top chunk metadata from either
// source, and emit a final ranked list.
//
// Why RRF and not learned fusion? Two reasons: it is parameter-free
// (no training), and it is robust to score scale differences between
// BM25 (unbounded negative) and vector (similarity in [0, 1]). It is
// also what most production RAG systems use. We are not above the
// consensus when the consensus is right.

import { bm25Search, type BM25Hit } from "./bm25";
import { vectorSearch } from "./vector";
import { embedOne } from "../embed";

const RRF_K0 = 60;

export interface FusedHit extends BM25Hit {
  rrf_score: number;
  bm25_rank: number | null;
  vector_rank: number | null;
}

export async function hybridSearch(query: string, opts: { repoId?: string; k?: number; trace_id?: string } = {}): Promise<FusedHit[]> {
  const k = opts.k ?? 10;

  const [bm25Hits, embedding] = await Promise.all([
    Promise.resolve(bm25Search(query, { repoId: opts.repoId, k: k * 2 })),
    embedOne(query, opts.trace_id),
  ]);
  const vecHits = vectorSearch(embedding, { repoId: opts.repoId, k: k * 2 });

  const scores = new Map<string, { hit: BM25Hit; rrf: number; bm25_rank: number | null; vector_rank: number | null }>();

  bm25Hits.forEach((hit, i) => {
    const rrf = 1 / (RRF_K0 + (i + 1));
    scores.set(hit.chunk_id, { hit, rrf, bm25_rank: i + 1, vector_rank: null });
  });
  vecHits.forEach((hit, i) => {
    const rrf = 1 / (RRF_K0 + (i + 1));
    const existing = scores.get(hit.chunk_id);
    if (existing) {
      existing.rrf += rrf;
      existing.vector_rank = i + 1;
    } else {
      scores.set(hit.chunk_id, { hit, rrf, bm25_rank: null, vector_rank: i + 1 });
    }
  });

  const fused: FusedHit[] = [...scores.values()]
    .map((s) => ({
      ...s.hit,
      rrf_score: s.rrf,
      bm25_rank: s.bm25_rank,
      vector_rank: s.vector_rank,
    }))
    .sort((a, b) => b.rrf_score - a.rrf_score);

  return fused.slice(0, k);
}