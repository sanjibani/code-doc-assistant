// Retrieval trace. Returns the top-K chunks that hybrid search
// returned for a given question, BEFORE the LLM is called.
// Drives the RetrievalPanel in the chat UI.
//
// We run BM25, vector, and the fusion in-process and return the
// real results. The shape matches what RetrievalPanel expects.

import { NextResponse } from "next/server";
import { bm25Search, type BM25Hit } from "@/lib/search/bm25";
import { vectorSearch, type VectorHit } from "@/lib/search/vector";
import { hybridSearch } from "@/lib/search/hybrid";
import { embedOne } from "@/lib/embed";

interface FusedRow {
  rank: number;
  path: string;
  lines: string;
  symbol: string;
  rrf: number;
  bm25_rank: number | null;
  vec_rank: number | null;
  in_both: boolean;
  picked: boolean;
}

function formatLines(start: number, end: number): string {
  return `L${start}-L${end}`;
}

function buildExplanation(
  bm25Top: BM25Hit | null,
  vecTop: VectorHit | null,
  fused: FusedHitLite[],
): { bm25_winner: string; vector_winner: string; rrf_promoted: string; dropped_for_llm: string } {
  const bm25Winner = bm25Top
    ? `${bm25Top.symbol ?? bm25Top.kind} — keyword match on tokens from the question (bm25=${bm25Top.score.toFixed(2)})`
    : "no BM25 hit";
  const vecWinner = vecTop
    ? `${vecTop.symbol ?? vecTop.kind} — semantic match (similarity=${vecTop.score.toFixed(3)})`
    : "no vector hit";
  const promoted = fused.find((f) => f.bm25_rank == null && f.vec_rank != null);
  const rrfPromoted = promoted
    ? `${promoted.symbol ?? promoted.path} — only vector caught it (vec_rank=${promoted.vec_rank}), RRF still picked it`
    : "none — every fused top-K appeared in BM25 too";
  const dropped = fused.filter((f) => !f.picked).slice(0, 3);
  const droppedStr =
    dropped.length > 0
      ? dropped.map((d) => `${d.symbol ?? d.path} (rrf=${d.rrf.toFixed(4)})`).join(", ")
      : "none (k >= total candidates)";
  return { bm25_winner: bm25Winner, vector_winner: vecWinner, rrf_promoted: rrfPromoted, dropped_for_llm: droppedStr };
}

interface FusedHitLite {
  path: string;
  symbol: string | null;
  kind: string;
  rrf: number;
  bm25_rank: number | null;
  vec_rank: number | null;
  picked: boolean;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const question = url.searchParams.get("q") ?? "";
  const repoId = url.searchParams.get("repo_id") ?? undefined;
  const k = Number(url.searchParams.get("k") ?? 8);
  if (!question) {
    return NextResponse.json({ ok: false, error: "missing ?q=" }, { status: 400 });
  }

  try {
    // Run all three legs in parallel. We need both the per-leg top-K
    // (for the column display) and the fused top-K (for the LLM).
    const [bm25All, embedding, fused] = await Promise.all([
      Promise.resolve(bm25Search(question, { repoId, k: k * 2 })),
      embedOne(question, `retrieve-${Date.now()}`),
      hybridSearch(question, { repoId, k }),
    ]);
    const vecAll = vectorSearch(embedding, { repoId, k: k * 2 });

    // Build the per-leg top rows.
    const bm25Rows = bm25All.slice(0, 6).map((h, i) => ({
      rank: i + 1,
      path: h.path,
      lines: formatLines(h.start_line, h.end_line),
      symbol: h.symbol ?? "",
      score: h.score,
    }));
    const vectorRows = vecAll.slice(0, 6).map((h, i) => ({
      rank: i + 1,
      path: h.path,
      lines: formatLines(h.start_line, h.end_line),
      symbol: h.symbol ?? "",
      sim: h.score,
    }));

    // Fused rows.
    const pickedIds = new Set(fused.map((f) => f.chunk_id));
    const fusedRows: FusedRow[] = fused.slice(0, 6).map((f, i) => ({
      rank: i + 1,
      path: f.path,
      lines: formatLines(f.start_line, f.end_line),
      symbol: f.symbol ?? "",
      rrf: f.rrf_score,
      bm25_rank: f.bm25_rank,
      vec_rank: f.vector_rank,
      in_both: f.bm25_rank != null && f.vector_rank != null,
      picked: true,
    }));

    // Add a "dropped" sample: top-K+1..K+3 from the fused set when
    // there's room. For the demo the fused list is already k=8, so
    // there are no drops; we add a small fallback showing items
    // present in either leg but past the fused K.
    const fusedIds = new Set(fused.map((f) => f.chunk_id));
    const dropCandidates = [...bm25All, ...vecAll]
      .filter((h) => !fusedIds.has(h.chunk_id))
      .slice(0, 3);
    const droppedRows = dropCandidates.map((h, i) => ({
      rank: fused.length + i + 1,
      path: h.path,
      lines: formatLines(h.start_line, h.end_line),
      symbol: h.symbol ?? "",
      rrf: 0,
      bm25_rank: null,
      vec_rank: null,
      in_both: false,
      picked: false,
    }));
    const allFusedRows = [...fusedRows, ...droppedRows];

    const explanation = buildExplanation(
      bm25All[0] ?? null,
      vecAll[0] ?? null,
      allFusedRows,
    );

    return NextResponse.json({
      ok: true,
      question,
      bm25: bm25Rows,
      vector: vectorRows,
      fused: fusedRows,
      explanation,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}