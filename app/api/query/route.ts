// POST /api/query
//   body: { question: string, repo_id?: string, k?: number }
//   returns: SSE stream of the cited answer.
//
// We do server-sent events with two event kinds:
//   - "chunk"  : { delta: string }    a piece of the answer text
//   - "done"   : { sources: Citation[], latency_ms: number }
//
// The client turns the text deltas into a streaming message and the
// sources into citation chips beneath it.

import { NextResponse } from "next/server";
import { z } from "zod";
import { hybridSearch } from "@/lib/search/hybrid";
import { streamCitedAnswer } from "@/lib/llm";
import { db } from "@/lib/db/client";

const Body = z.object({
  question: z.string().min(1).max(2000),
  repo_id: z.string().optional(),
  k: z.number().int().min(1).max(30).optional(),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }

  const traceId = `q-${Date.now()}`;
  const t0 = Date.now();
  const hits = await hybridSearch(body.question, { repoId: body.repo_id, k: body.k ?? 8, trace_id: traceId });

  // Pull the most-recent ingest default branch info for the citation URL.
  // We use file:// links to the local checkout. Real product would map to github.com/<owner>/<repo>/blob/<sha>/path.
  const conn = db();
  const repoInfo = body.repo_id
    ? (conn.prepare("SELECT url, local_path, default_branch, commit_sha FROM repos WHERE id = ?").get(body.repo_id) as
        | { url: string; local_path: string; default_branch: string; commit_sha: string | null }
        | undefined)
    : undefined;

  const chunks = hits.map((h) => ({
    id: h.chunk_id,
    path: h.path,
    start_line: h.start_line,
    end_line: h.end_line,
    symbol: h.symbol,
    kind: h.kind,
    text: h.text,
  }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const delta of streamCitedAnswer({
          question: body.question,
          chunks,
          repo_name: repoInfo?.url ?? "codebase",
          trace_id: traceId,
        })) {
          controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify({ delta })}\n\n`));
        }
        const sources = hits.map((h) => ({
          chunk_id: h.chunk_id,
          path: h.path,
          start_line: h.start_line,
          end_line: h.end_line,
          symbol: h.symbol,
          kind: h.kind,
          rrf_score: h.rrf_score,
          bm25_rank: h.bm25_rank,
          vector_rank: h.vector_rank,
          local_path: repoInfo?.local_path,
          branch: repoInfo?.default_branch,
        }));
        controller.enqueue(
          encoder.encode(
            `event: done\ndata: ${JSON.stringify({ sources, latency_ms: Date.now() - t0 })}\n\n`,
          ),
        );
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}