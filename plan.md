# plan.md

Code Documentation Assistant — overnight build.

## Goal

Build Option 2 (Code Documentation Assistant) from the AI FDE assignment: a system that ingests a codebase and answers questions about it. Chat with the code, with cited file:line references.

## Stack decision (already made, defended in README)

- **Frontend + API**: Next.js 15 (App Router, RSC), TypeScript strict
- **Vector store**: sqlite-vec (single file, no Docker)
- **Hybrid search**: SQLite FTS5 (BM25) + sqlite-vec (dense), fused with Reciprocal Rank Fusion
- **Chunking**: tree-sitter (TS + Python) for AST-aware chunks; fallback to sliding window for unsupported langs
- **Embeddings**: MiniMax `text-embedding-3-small` equivalent via `https://api.minimax.io/v1` (OpenAI-compatible)
- **LLM**: MiniMax-Text-01 via same base URL, streaming
- **Architecture map**: react-flow + force-directed graph from import graph
- **Eval**: 25 hand-written Q&A pairs, regression script in `eval/`
- **Deploy**: Cloudflare Pages + Workers (or Vercel as fallback). Plan for it in README.

## Approach

Pull memory, not push memory. The assistant is a queryable brain for code, not a preloaded context dump. (See mvanhorn, "Skills over Memory.")

1. Ingest repo → AST chunk → embed → store (chunk, embedding, FTS5 row)
2. Query → embed query → FTS5 BM25 + vector ANN → RRF fuse → top-K
3. LLM with cited-answer prompt → stream tokens + structured citations
4. UI shows answer with `[src: path/to/file.ts#L42-L67]` chips that link to GitHub raw

## Files to create

```
code-doc-assistant/
  app/
    layout.tsx
    page.tsx                     # chat UI (home)
    api/
      ingest/route.ts            # POST { repoUrl | localPath } -> kick off ingest
      query/route.ts             # POST { question } -> streaming response
      graph/route.ts             # GET -> import graph JSON
      eval/route.ts              # POST -> run eval harness
    components/
      Chat.tsx                   # main chat surface
      Citation.tsx               # cited source chip
      ArchitectureMap.tsx        # react-flow dep graph
      EvalRunner.tsx             # eval results panel
  lib/
    chunker/
      index.ts                   # dispatcher: lang -> parser
      tree-sitter-ts.ts
      tree-sitter-py.ts
      fallback.ts                # sliding window
    embed.ts                     # MiniMax embeddings client
    llm.ts                       # MiniMax LLM client (stream)
    db/
      schema.sql                 # tables: repos, files, chunks, chunks_fts, chunks_vec
      migrate.ts                 # apply schema
      client.ts                  # better-sqlite3 + sqlite-vec handle
    search/
      bm25.ts                    # FTS5 query
      vector.ts                  # sqlite-vec KNN
      hybrid.ts                  # RRF fusion
    ingest.ts                    # clone repo + walk + chunk + embed + insert
    prompt.ts                    # cited-answer system prompt
    eval.ts                      # eval harness
  eval/
    fixtures/
      code-doc-assistant.eval.jsonl   # 25 Q&A pairs against a demo repo
  scripts/
    ingest-cli.ts                # CLI for ingesting a local repo
    eval.ts                      # CLI for running eval
  public/                        # static assets
  README.md                      # assignment deliverable
  AGENTS.md                      # project rules for the build agent (under 200 lines)
  plan.md                        # this file
  TASKS.md                       # running log of what was done
  package.json
  tsconfig.json
  next.config.ts
  .env.example                   # MiniMax API key placeholder
```

## Acceptance criteria

- [ ] `pnpm install && pnpm dev` boots the app on localhost:3000
- [ ] `pnpm ingest <path-to-repo>` indexes a repo, prints chunks count
- [ ] Chat UI accepts a question, streams a response, citations render as chips
- [ ] Clicking a citation jumps to the raw file at github.com/.../path#L42-L67
- [ ] `pnpm eval` runs 25 Q&A pairs and prints recall@k + answer-citation-rate
- [ ] Architecture map renders dep graph, click node filters context
- [ ] README is the assignment deliverable, mvanhorn voice (no em-dashes, no bold walls, decisions defended)
- [ ] AGENTS.md < 200 lines, gold-standard only

## Out of scope (document in README)

- Multi-tenant auth
- Incremental re-index on file change (re-run ingest CLI for now)
- Cross-repo search
- More than TS + Python tree-sitter parsers
- Voice input

## Risks and mitigations

- **MiniMax API key**: read from `.env`, fail loudly if missing at boot
- **tree-sitter native bindings**: pin versions, use prebuilt binaries
- **sqlite-vec loadable extension**: bundle the .so/.dylib path or use the npm package
- **Streaming in Next.js App Router**: use `ReadableStream` response with proper headers
- **Embedding cost on full repo**: chunk first, embed only chunks > 50 chars

## Non-code work to do

- README writing: plan for the plan first (decide sections, decide voice, decide what's missing). Then draft.
- Screenshots: after UI is functional.

## Workflow rules (per mvanhorn)

1. Plan.md first, never read it after writing
2. Default new tab to agent (Claude/Codex); I'm Mavis, single session, multiple tool calls in parallel
3. YOLO mode for this session — no permission asks for known-safe operations
4. Skills > memory: when I learn a lesson, write it as a reusable command, not a journal entry
5. Human signal: react and redirect, don't hand-type code
6. Touch grass in the README