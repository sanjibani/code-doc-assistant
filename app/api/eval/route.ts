// POST /api/eval
//   body: { repo_id?: string, fixtures?: string }
//   returns: { run_id, total, passed, recall_at_5, cite_rate, results: EvalResultRow[] }
//
// We run the eval harness in-process. Default fixtures live in
// eval/fixtures/code-doc-assistant.eval.jsonl. Pass `fixtures` in
// the body to run a different file (e.g. code-doc-assistant-self).

import { NextResponse } from "next/server";
import { runEval } from "@/lib/eval";

export async function POST(req: Request) {
  let body: { repo_id?: string; fixtures?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body ok
  }
  try {
    process.stderr.write(`[eval route] start, repo=${body.repo_id} fixtures=${body.fixtures}\n`);
    const result = await runEval({ repoId: body.repo_id, fixturesFile: body.fixtures });
    process.stderr.write(`[eval route] done, total=${result.total} passed=${result.passed}\n`);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : "";
    process.stderr.write(`[eval route] ERROR: ${msg}\n${stack}\n`);
    return NextResponse.json({ ok: false, error: msg, stack }, { status: 500 });
  }
}