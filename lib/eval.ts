// Eval harness. Reads eval/fixtures/*.jsonl, runs hybrid search for
// each question against the indexed repo, and scores:
//   - recall@5: fraction of expected paths that appear in the top-5 retrieved chunks
//   - cited:    fraction of answers that include at least one [src:...] citation
// We also persist the run to the DB so trends show up in the README.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";

import { hybridSearch } from "./search/hybrid";
import { streamCitedAnswer } from "./llm";
import { db } from "./db/client";

const FIXTURES_DIR = join(process.cwd(), "eval", "fixtures");

interface EvalFixture {
  question: string;
  expected_paths: string[]; // any of these counts as a hit
  must_cite?: boolean;      // answer must include a [src:...] citation
}

export interface EvalOptions {
  repoId?: string;
  fixturesFile?: string;
}

export interface EvalResultRow {
  question: string;
  expected_paths: string[];
  retrieved_paths: string[];
  cited: boolean;
  recall_at_5: number;
}

export interface EvalSummary {
  run_id: string;
  total: number;
  passed: number;
  recall_at_5: number;
  cite_rate: number;
  results: EvalResultRow[];
  duration_ms: number;
}

export async function runEval(opts: EvalOptions = {}): Promise<EvalSummary> {
  const t0 = Date.now();
  const fixtures = await loadFixtures(opts.fixturesFile ?? "code-doc-assistant.eval.jsonl");
  const conn = db();
  const runId = nanoid();
  const startedAt = new Date().toISOString();

  const rows: EvalResultRow[] = [];
  const insertResult = conn.prepare(
    `INSERT INTO eval_results (run_id, question, expected_paths, retrieved_paths, cited, recall_at_5)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let total = 0;
  let passed = 0;
  let recallSum = 0;
  let citedCount = 0;

  for (const fx of fixtures) {
    total += 1;
    let hits;
    try {
      hits = await hybridSearch(fx.question, { repoId: opts.repoId, k: 5, trace_id: `eval-${runId}` });
    } catch (e) {
      // Skip this question if hybrid search failed (e.g., no API key
      // for embeddings). Record zero recall and continue. This keeps
      // the harness useful even when the LLM path is down.
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[eval] hybrid search failed for "${fx.question.slice(0, 60)}...": ${msg}\n`);
      rows.push({
        question: fx.question,
        expected_paths: fx.expected_paths,
        retrieved_paths: [],
        cited: false,
        recall_at_5: 0,
      });
      insertResult.run(runId, fx.question, JSON.stringify(fx.expected_paths), "[]", 0, 0);
      continue;
    }
    const retrievedPaths = hits.map((h) => h.path);
    const hitSet = new Set(retrievedPaths);
    const expectedHit = fx.expected_paths.filter((p) => hitSet.has(p));
    const recallAt5 = fx.expected_paths.length === 0 ? 1 : expectedHit.length / fx.expected_paths.length;
    recallSum += recallAt5;

    // Run the LLM and detect whether it cited anything.
    let cited = false;
    if (fx.must_cite) {
      let acc = "";
      for await (const delta of streamCitedAnswer({
        question: fx.question,
        chunks: hits.map((h) => ({
          id: h.chunk_id,
          path: h.path,
          start_line: h.start_line,
          end_line: h.end_line,
          symbol: h.symbol,
          kind: h.kind,
          text: h.text,
        })),
        repo_name: "eval",
        trace_id: `eval-${runId}`,
      })) {
        acc += delta;
      }
      cited = /\[src:\s*[\w./-]+#L\d+-L\d+\]/.test(acc);
    }

    const row: EvalResultRow = {
      question: fx.question,
      expected_paths: fx.expected_paths,
      retrieved_paths: retrievedPaths,
      cited,
      recall_at_5: recallAt5,
    };
    rows.push(row);
    if (recallAt5 === 1 && (!fx.must_cite || cited)) passed += 1;
    if (cited) citedCount += 1;
    insertResult.run(runId, fx.question, JSON.stringify(fx.expected_paths), JSON.stringify(retrievedPaths), cited ? 1 : 0, recallAt5);
  }

  const finishedAt = new Date().toISOString();
  conn.prepare(
    `INSERT INTO eval_runs (id, started_at, finished_at, total, passed, recall_at_5, cite_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(runId, startedAt, finishedAt, total, passed, recallSum / Math.max(total, 1), citedCount / Math.max(total, 1));

  return {
    run_id: runId,
    total,
    passed,
    recall_at_5: recallSum / Math.max(total, 1),
    cite_rate: citedCount / Math.max(total, 1),
    results: rows,
    duration_ms: Date.now() - t0,
  };
}

async function loadFixtures(filename: string): Promise<EvalFixture[]> {
  const path = join(FIXTURES_DIR, filename);
  if (!existsSync(path)) {
    throw new Error(`fixtures not found: ${path}`);
  }
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EvalFixture);
}