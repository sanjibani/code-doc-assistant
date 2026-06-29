// Live ingest trace API.
// GET /api/ingest/trace?repo_id=...
//   returns { ok, repo_id, trace: IngestEvent[] } — the most recent
//   ingest events for this repo from the in-memory buffer in
//   lib/ingest-progress.ts. The buffer is fed by lib/ingest.ts
//   during real ingest, so what you see here is what actually ran.

import { NextResponse } from "next/server";
import { getEvents } from "@/lib/ingest-progress";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoId = url.searchParams.get("repo_id");
  if (!repoId) {
    return NextResponse.json({ ok: false, error: "repo_id required" }, { status: 400 });
  }
  const trace = getEvents(repoId);
  return NextResponse.json({ ok: true, repo_id: repoId, trace });
}