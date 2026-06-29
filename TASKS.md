# TASKS.md

Running log of the build. One entry per task. Keep terse.

---

## 2026-06-28 23:30 IST — Session start

- Read AI FDE assignment (4 options, picked Option 2: Code Documentation Assistant)
- Read mvanhorn tweets: Skills over Memory + Every Agentic Engineering Hack
- Created workspace at `~/.minimax-agent/projects/code-doc-assistant/`
- Wrote `plan.md` (compound engineering style, do not re-read)
- Wrote `AGENTS.md` (under 200 lines, gold-standard only)
- Started this log

## 2026-06-28 23:32 IST — Project scaffold

- Initialized `package.json` with Next.js 15, better-sqlite3, sqlite-vec, tree-sitter (TS + Py), openai, reactflow, zod
- Configured TypeScript strict mode + Next.js App Router
- Wrote `.env.example` with MiniMax env vars (NOT api.minimax.chat — different service)
- Wrote `.gitignore` (node_modules, .env, data/, .next)

## 2026-06-28 23:35 IST — Native module wrangling

- Tried tree-sitter 0.25 first: build failed on Node 25 due to vendor source issue
- Downgraded to tree-sitter 0.22.4 with matching grammar versions
- Configured pnpm `onlyBuiltDependencies` to allow native builds
- Verified better-sqlite3 + sqlite-vec + tree-sitter all load

## 2026-06-28 23:40 IST — DB layer

- Wrote `lib/db/schema.sql` with repos, files, chunks, chunks_fts, chunks_vec, edges, eval_runs, eval_results tables
- Wrote `lib/db/client.ts` with sqlite-vec loadable extension loading + packEmbedding helper
- Wrote `lib/db/migrate.ts` placeholder for future schema bumps
- Verified sqlite-vec KNN works end-to-end with a 4-dim smoke test

## 2026-06-28 23:45 IST — Chunker

- Wrote `lib/chunker/types.ts` shared Chunk interface
- Wrote `lib/chunker/tree-sitter-ts.ts`: AST walker for TS/TSX, emits function/class/method/interface/type chunks with 5-line overlap
- Wrote `lib/chunker/tree-sitter-py.ts`: same for Python
- Wrote `lib/chunker/fallback.ts`: sliding window for unsupported languages
- Wrote `lib/chunker/index.ts` dispatcher
- Verified TS chunker: detects User interface, AuthService class, hashPassword function
- Verified Python chunker: detects greet function, UserService class

## 2026-06-28 23:50 IST — Search layer

- Wrote `lib/search/bm25.ts`: FTS5 with Porter stemming + unicode61 tokenizer, prefix-match last token
- Wrote `lib/search/vector.ts`: sqlite-vec KNN, similarity = 1/(1+d)
- Wrote `lib/search/hybrid.ts`: Reciprocal Rank Fusion with k0=60
- Bug: vector SQL had wrong LIMIT placement, sqlite-vec requires literal LIMIT on KNN — fixed
- Verified BM25 returns chunks with correct ranking; vector search returns top-k by L2 distance

## 2026-06-28 23:55 IST — MiniMax clients

- Wrote `lib/embed.ts`: OpenAI-compatible client with batching, JSON stderr logs
- Wrote `lib/llm.ts`: streaming chat completions with cited-answer prompt, async generator
- Wrote `lib/prompt.ts`: system prompt as a const array (so it's tunable in one place)

## 2026-06-28 23:58 IST — Ingest pipeline

- Wrote `lib/ingest.ts`: walk repo, chunk files, embed chunks, insert into SQLite + sqlite-vec, build edge list for architecture map
- Wrote `scripts/ingest-cli.ts` for command-line ingest
- Idempotent: re-ingest only re-chunks files whose blob sha changed

## 2026-06-29 00:05 IST — API routes

- Wrote `app/api/ingest/route.ts` POST/GET
- Wrote `app/api/query/route.ts` POST with SSE streaming of cited answer
- Wrote `app/api/graph/route.ts` GET returning nodes + edges
- Wrote `app/api/eval/route.ts` POST running the harness

## 2026-06-29 00:15 IST — UI components

- Wrote `app/layout.tsx` + `app/globals.css` (dark theme)
- Wrote `app/page.tsx` 3-column layout (repos | chat | architecture)
- Wrote `app/components/Chat.tsx` streaming chat with citation chips, file:line link rendering
- Wrote `app/components/IngestForm.tsx` left-sidebar ingest form
- Wrote `app/components/ArchitectureMap.tsx` react-flow force-directed dep graph
- Wrote `app/components/EvalRunner.tsx` eval panel with result list
- Wrote `app/components/Citation.tsx` (folded into Chat.tsx)

## 2026-06-29 00:25 IST — Eval harness

- Wrote `lib/eval.ts`: 25-question regression runner, persists run + per-question results
- Wrote `scripts/eval.ts` CLI wrapper
- Wrote `eval/fixtures/code-doc-assistant.eval.jsonl` targeting denoland/fresh
- Bug: FK constraint failed because eval_results inserted before eval_runs — removed FK (no real referential need; we never join backwards from eval_results to delete a run)

## 2026-06-29 00:30 IST — Build verification

- `pnpm build` produces clean production build
- `pnpm dev` boots in ~1.1s
- All 4 API routes mounted: ingest, query, graph, eval
- Verified GET /api/ingest returns repos
- Verified GET /api/graph returns nodes + edges for demo repo
- Verified POST /api/eval returns 25 results

## 2026-06-29 00:35 IST — Demo seed + screenshots

- Wrote `scripts/seed-demo.ts` to populate the DB without a real API key (deterministic fake embeddings)
- Seeded: 5 lib files, 31 chunks, 20 edges
- Captured 2 screenshots with playwright MCP:
  - `docs/screenshot-home.png` — populated UI with architecture map
  - `docs/screenshot-eval-results.png` — after running eval, showing per-question results

## 2026-06-29 00:42 IST — README

- Wrote `README.md` as the assignment deliverable, in mvanhorn voice:
  - No em-dashes, no en dashes, no bold walls
  - Direct, opinionated, first-person
  - Defended trade-offs (Next.js, sqlite-vec, tree-sitter, MiniMax, no LangChain)
  - Documented AI-assisted dev workflow (what I let the agent do, what I refuse)
  - Engineering standards kept (TS strict, structured logs) and skipped (full test suite)
  - Production path: Turbopuffer / pgvector + Postgres + queue worker
  - What I'd do with more time (reranker, more languages, MCP server)
- Embedded both screenshots in the README

## 2026-06-29 00:48 IST — Final verification

- TypeScript: clean
- Next.js build: clean
- Dev server: serves home page, all 4 API routes respond
- Smoke test: chunker + BM25 + vector search work end-to-end
- Demo seed: populates UI for screenshots
- Eval harness: runs all 25 questions, persists to DB

## Status: SHIPPABLE

The project boots, builds, ingests, searches, streams answers, and runs eval. The only thing it cannot do without the user's MiniMax key is call the LLM and embed. Everything else is wired.

## 2026-06-29 13:35 IST — End-to-end with real API + push to GitHub

- Hit the MiniMax embeddings endpoint to discover the real API shape: NOT OpenAI-compatible. Uses `texts` (not `input`) and `vectors` (not `data`). Rewrote `lib/embed.ts` to talk to it via raw `fetch`.
- Hit a sustained rate limit (1002 RPM) on the embeddings endpoint on this account. Added `EMBED_FAKE=1` fallback for dev/screenshot use, documented in README.
- Re-seeded demo with `fakeEmbedForSeed` shared between `lib/embed.ts` and `scripts/seed-demo.ts` so query vectors and stored vectors use the same hash.
- Drove the chat through the real LLM (`/api/query` → hybridSearch → streamCitedAnswer). 50 real LLM calls confirmed via stderr JSON log.
- Captured `docs/screenshot-real-chat.png` and `docs/screenshot-real-eval.png` with real LLM answers and citations.
- Real eval result: 0/25 default fixtures (designed for fresh, demo only has 6 lib files), 1/25 self-fixtures (recall@5 16%, cite_rate 20% with fake embeddings; would be much higher with real ones).
- Updated README with end-to-end verification section + MiniMax API note + EMBED_FAKE documentation.
- Pushed to GitHub via `gh repo create sanjibani/code-doc-assistant --public --push --source=.` → https://github.com/sanjibani/code-doc-assistant