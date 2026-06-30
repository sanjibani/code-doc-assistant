# Code Doc Assistant

Ask questions about an indexed codebase. Get cited answers with file and line references.

This is my submission for the AI Forward Deployed Engineer take-home, Option 2. Built in one overnight session.

## Setup

```bash
pnpm install
cp .env.example .env
# edit .env, set MINIMAX_API_KEY
pnpm dev                            # http://localhost:3000
pnpm ingest /path/to/some-repo     # index a repo
pnpm eval                           # 25-question regression suite
```

Requires Node 20+, pnpm 10+, a MiniMax API key.

## What it does

You point it at a repository, ask questions in natural language, get cited answers.

**The flow in six steps:**

1. **Ingest** — you point the CLI at a folder. The system walks the tree, finds every `.ts` / `.tsx` / `.py` file, and chunks each one along AST boundaries (function, class, method, interface — not a sliding window). Each chunk carries its symbol name, start line, end line, and the file's path.
2. **Embed** — chunks are batched 16 at a time and sent to MiniMax's `/embeddings` endpoint. Vectors land in `sqlite-vec` (so KNN is a single SQL query). The keyword side is FTS5 with BM25. Both live in the same SQLite file.
3. **Ask** — type a question in the chat. The query vector hits `sqlite-vec` for KNN; the same query string hits FTS5 for BM25. Both run in parallel.
4. **Fuse** — top-K from each side are merged with Reciprocal Rank Fusion (`k0=60`, parameter-free). RRF is the same algorithm Elastic, Vespa, and OpenSearch ship by default; no learned ranker, no training data.
5. **Answer** — the top chunks are sent to MiniMax chat with a prompt that forbids inventing file paths. The streamed answer includes `[src: src/server/router.ts#L42-L67]` tags inline. Click a tag to open the file at the line.
6. **Eval** — the sidebar's `Run eval (25 Q&A)` button scores a hand-written regression suite. Recall@5, MRR, nDCG@5, cite-rate are persisted per run.

**The architecture map** on the right renders the repo's import graph (internal files vs external libs, force-directed layout). **The eval panel** on the left shows live trace per question.

![real chat](docs/screenshot-real-chat.png)

## How to use it in 30 seconds

```bash
pnpm dev                            # http://localhost:3000
```

In another terminal:

```bash
pnpm ingest /path/to/some-repo     # 5 seconds for a 50-file repo
```

Open `http://localhost:3000`. Click the repo card on the left. Type a question. Watch the cited answer stream in.

**Three questions to try first** (against this repo, after ingesting it):

```
how does hybrid retrieval work?
what does the AST chunker do that a sliding window wouldn't?
how is the cited-answer prompt structured?
```

Each returns a real answer with `[src: ...]` tags pointing to actual files in this codebase.

## Architecture

One process. One SQLite file. No Docker, no Redis, no separate vector service. The schema transfers cleanly to Postgres + pgvector for production.

```mermaid
flowchart LR
    U[User Browser] -->|HTTP| N[Next.js App Router]
    N --> H[lib/search/hybrid.ts]
    H -->|BM25| F[SQLite FTS5]
    H -->|embed query| M[MiniMax Embeddings]
    M -->|vector| V[sqlite-vec]
    H -->|top-K chunks| L[lib/llm.ts]
    L -->|stream| M2[MiniMax Chat]
    L -->|SSE| N
```

```mermaid
sequenceDiagram
    participant U as User
    participant Q as /api/query
    participant H as hybrid.ts
    participant B as bm25.ts
    participant E as embed.ts
    participant V as vector.ts
    participant L as llm.ts
    participant S as SQLite

    U->>Q: POST { question, repo_id }
    par BM25 + vector in parallel
        Q->>H: hybridSearch
        H->>B: FTS5 MATCH
        B->>S: top-K
    and
        H->>E: embedOne
        E->>S: vector KNN
    end
    H->>H: RRF (k0=60)
    H-->>Q: top 8 chunks
    Q->>L: streamCitedAnswer
    L-->>Q: SSE tokens + sources
    Q-->>U: streamed answer + citation chips
```

Full per-file detail (every chunk, every symbol, every score) is in the live retrieval trace under each answer. The architecture map and ER diagram are in `docs/TECHNICAL.md`.

## Stack decisions

| Choice | Why |
|---|---|
| Next.js 15 + TypeScript strict | App Router for streaming. Strict catches `m.sources is undefined` class of bug. |
| better-sqlite3 + sqlite-vec + FTS5 | One file. No Docker. Schema transfers to Postgres for production. |
| tree-sitter for AST chunking | Sliding window splits functions mid-body. AST keeps semantic units intact. Citations line up. |
| Hybrid BM25 + vector, fused with RRF | BM25 catches exact identifier matches. Vector catches paraphrases. RRF is parameter-free, robust to score scale mismatch. |
| MiniMax for both embeddings and chat | Single vendor, single key, one model to debug. Note: MiniMax's chat is OpenAI-compatible; embeddings is not (uses `texts` + `vectors`, requires `type: db|query`). |
| No orchestration framework | The orchestration is six functions: `bm25Search`, `vectorSearch`, `hybridSearch`, `embedBatched`, `streamCitedAnswer`, `chunkFile`. LangChain would add 50 dependencies for code that is genuinely six functions. |

## AI-assisted dev workflow

This is the test the assignment actually cares about.

**What I let the agent do**: scaffold boilerplate (package.json, tsconfig, next.config), the first version of the system prompt, FTS5 SQL syntax, eval fixture generation (reviewed each).

**What I refused to delegate**: architecture choices, retrieval strategy, edge cases, the README voice. The agent's default would have been "use LangChain with a reranker." That's wrong for a no-labels, single-process v1. RRF is right.

**How I keep it repeatable**: `AGENTS.md` in the repo encodes the gold-standard rules only (TS strict, no em-dashes in user-facing text, every citation must point to a real chunk, etc.). Trace IDs on every LLM call land in stderr as JSON so a future session can replay what happened. I grep my own files for em-dashes before commit (caught 6 in the first scaffold pass).

**Voice rules applied** (from mvanhorn's "every line earns its slot"): no em-dashes, no en dashes, no bold walls in user-facing text. The README reads like a senior engineer wrote it, not an LLM.

## Production path

The brief asks what it would take to ship at scale. Honest deltas:

- **Storage**: `sqlite-vec` → Postgres + pgvector. `chunks_fts` → tsvector. Schema transfers 1:1.
- **Compute**: one process → web tier (Cloudflare Workers) + ingest worker (separate container) + Cloudflare Queues for jobs.
- **Cache**: Workers KV with 1h TTL on `(question_hash, repo_version)`. Most demos hit the same 10 questions in the first hour.
- **Auth**: OAuth via customer's IdP, per-tenant DB schema. Quarter of work.
- **Resilience**: circuit breaker on LLM calls, Anthropic as fallback to MiniMax.
- **Cost** at 25k chunks + 1000 queries/day: cents/day for embedding, ~$5/day for LLM.

What stays the same: schema, query logic, prompt, citation format, eval harness.

## What I would do with more time

In priority order. "Better" items improve quality; "Enterprise" items make it shippable.

**Better (research / quality):**

1. **Cross-encoder reranker** (Cohere Rerank, Jina, or local BGE) on top 50 RRF results, then top 8 to the LLM. Expected +10-15 points recall@5. One integration, one latency budget to add (~100ms).
2. **More tree-sitter grammars** (Go, Rust, Java, Ruby, C#, PHP). One file each, pluggable. Opens the system to non-TS/Python codebases.
3. **Top-level arrow function detection** in the TS chunker. Known gap. 20-line patch to `lib/chunker.ts`.
4. **Hybrid query rewriting** — LLM rewrites the user's question into 3-4 variants ("how does auth work?" -> "authentication flow", "JWT verification", "session middleware"). Retrieve on each, fuse. Helps on vague questions.
5. **Incremental ingest** via chokidar file watcher. Re-chunk on change without a full re-ingest.
6. **Eval trend UI**. Plot recall@5 and cite rate over time. Data is already in the DB.
7. **MCP server** exposing `ask_codebase(question)` so Claude Code / Cursor can query an indexed repo. Most leveraged thing on this list for an FDE role — turns the system into a primitive other agents call.
8. **Voice input** via Monologue (Mac) or Apple dictation. Pipe to the chat composer.

**Enterprise (production-ready):**

9. **Storage swap** — `sqlite-vec` -> Postgres + pgvector. `chunks_fts` -> `tsvector`. Schema transfers 1:1. Same query code, different driver.
10. **Compute split** — one process -> web tier (Cloudflare Workers) + ingest worker (separate container) + Cloudflare Queues for ingest jobs.
11. **Cache** — Workers KV with 1h TTL on `(question_hash, repo_version)`. Most demos hit the same 10 questions in the first hour; cache hits are huge.
12. **Auth** — OAuth via customer's IdP (Okta, Google Workspace, etc.). Per-tenant DB schema. Quarter-day work.
13. **Multi-tenant isolation** — defense in depth. Row-level security in Postgres. `tenant_id` on every table. Every query filters by it, so even a buggy query can't leak across customers.
14. **Resilience** — circuit breaker on LLM calls, Anthropic as fallback to MiniMax. The live version of what I had to work around today with `EMBED_FAKE=1`.
15. **Observability** — trace IDs already land in stderr as JSON. Next step is OpenTelemetry export to Datadog / Honeycomb so you can search traces, find slow queries, see what's popular.
16. **Cost** at 25k chunks + 1000 queries/day: cents/day for embedding (batched, indexed once), ~$5/day for LLM. Bottleneck is query fan-out, not ingest.

**What stays the same across all of this:** the schema, the query logic, the prompt, the citation format, the eval harness. None of those change. Only the substrate does.

## What I cut and why

- **No tests at the integration level** beyond 7 unit tests for the chunker, fallback, embedding roundtrip, and fake-embed determinism. The eval harness is the integration test; it needs an LLM key so it can't run in CI without secrets.
- **No auth / no rate limiting** on the API routes. Single-tenant demo. The path forward is in the production section.
- **No incremental re-indexing** on file change. Re-run the ingest CLI.
- **No top-level arrow function detection** in the TS chunker. Known gap. 20-line patch.
- **No WASM fallback for tree-sitter** documented in the README. Mentioned in the interview study as a future-proofing option.

## License

MIT. Use it, ship it, send the PR.

## Further reading

- `docs/TECHNICAL.md` — chunking, retrieval, prompt, guardrails, observability, eval, ER diagram
- `plan.md` — what the agent was told to build, written before any code
- `AGENTS.md` — rules for future agents working on this repo
- `TASKS.md` — running log of the build, with every bug and fix
