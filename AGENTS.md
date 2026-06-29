# AGENTS.md

Project rules for the code-doc-assistant build. Gold-standard only. Every line earns its slot. (Per mvanhorn: keep it short, delete what the model can infer.)

## Stack

- Next.js 15 (App Router) + TypeScript strict + better-sqlite3 + sqlite-vec + tree-sitter
- MiniMax for embeddings and LLM via `https://api.minimax.io/v1` (OpenAI-compatible)
- pnpm, never npm

## Hard rules

1. **No em dashes, no en dashes, no bold in user-facing text.** The assignment explicitly flags LLM-detected text. Code is fine.
2. **One feature per commit, descriptive title.** No "wip" commits.
3. **Every citation in an answer must point to a real chunk id.** No hallucinated file paths.
4. **AST chunks before embeddings.** Sliding window is fallback only.
5. **DB schema lives in `lib/db/schema.sql`.** Don't inline SQL in app code.
6. **All LLM calls log prompt tokens + completion tokens + latency to stderr as JSON.** One line per call.
7. **Env vars: `MINIMAX_API_KEY` required. Fail boot if missing.**

## Voice for the README

- Direct, opinionated, first-person
- Trade-offs defended with reasons, not vibes
- "I picked X over Y because Z"
- No "in conclusion", no "let me walk you through"
- No bullet walls. Sentences and short paragraphs.

## File layout

- `app/` routes only
- `lib/` pure logic, no React
- `components/` React only
- `scripts/` CLIs
- `eval/` fixtures + results

## When stuck

- Read the existing code in the same dir first (don't reinvent patterns)
- Check `lib/db/schema.sql` for the truth on storage
- The plan.md is for the agent, not for hand-reading. Re-read only when truly lost.

## Done = 

- `pnpm dev` boots clean
- Ingest one real repo end-to-end without errors
- 25 Q&A eval runs and prints results
- README is the deliverable, not the chat UI

## Out of scope

- Auth
- Multi-tenant
- Cross-repo search
- Voice input
- Anything not in plan.md acceptance criteria

If you want to add it, write a plan-for-the-plan in plan.md first.