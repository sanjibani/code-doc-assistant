// POST /api/ingest
//   body: { local_path: string, repo_url?: string, name?: string }
//   returns: { ok: true, repo_id, file_count, chunk_count, edge_count, duration_ms }
//
// GET /api/ingest
//   returns: { repos: Repo[] }
//
// The GET endpoint exists so the client can list indexed repos on
// page load without a separate route. POST kicks off a full ingest.

import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestRepo } from "@/lib/ingest";
import { db } from "@/lib/db/client";

const PostBody = z.object({
  local_path: z.string().min(1),
  repo_url: z.string().url().optional(),
  name: z.string().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  try {
    const result = await ingestRepo({
      repoUrl: body.repo_url ?? `file://${body.local_path}`,
      repoName: body.name ?? body.local_path.split("/").pop() ?? "repo",
      localPath: body.local_path,
      traceId: `ingest-${Date.now()}`,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  const conn = db();
  // Sort by chunk_count desc so populated repos surface first.
  // Filter out zero-chunk stubs (failed ingests that left orphan rows).
  const rows = conn
    .prepare(
      "SELECT id, name, url, file_count, chunk_count FROM repos WHERE chunk_count > 0 ORDER BY chunk_count DESC, ingested_at DESC",
    )
    .all() as Array<{ id: string; name: string; url: string; file_count: number; chunk_count: number }>;
  return NextResponse.json({ repos: rows });
}