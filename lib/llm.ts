// MiniMax LLM client. Streaming-friendly.
//
// Strategy: we want streaming so the UI feels alive. The chat route
// returns a ReadableStream of SSE-style events. We also want every
// answer to carry structured citations. We do this by asking the
// LLM to emit citations inline as `[src: path/to/file.ts#L42-L67]`
// tags and then post-processing the streamed tokens into structured
// citation chips on the client.
//
// We use a small JSON Schema (via zod) for the system prompt so the
// LLM has a stable contract. We are NOT using tool/function calling
// here because the cited-answer pattern is simpler and the LLM is
// good at it for small context windows.

import OpenAI from "openai";
import { z } from "zod";

const ENDPOINT = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
const MODEL = process.env.MINIMAX_LLM_MODEL ?? "MiniMax-Text-01";

function client(): OpenAI {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("MINIMAX_API_KEY is required. Set it in .env");
  return new OpenAI({ apiKey: key, baseURL: ENDPOINT });
}

export const Citation = z.object({
  path: z.string(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
});
export type Citation = z.infer<typeof Citation>;

export interface CitedAnswerInput {
  question: string;
  chunks: Array<{
    id: string;
    path: string;
    start_line: number;
    end_line: number;
    symbol: string | null;
    kind: string;
    text: string;
  }>;
  repo_name: string;
  trace_id?: string;
}

export async function* streamCitedAnswer(input: CitedAnswerInput): AsyncGenerator<string, void, void> {
  const c = client();
  const system = buildSystemPrompt(input.repo_name);
  const user = buildUserPrompt(input.question, input.chunks);

  const t0 = Date.now();
  let completion_tokens = 0;
  let prompt_tokens = 0;

  const stream = await c.chat.completions.create({
    model: MODEL,
    stream: true,
    temperature: 0.1,
    max_tokens: 1200,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      completion_tokens += 1; // rough; real count is in usage
      yield delta;
    }
    if (chunk.usage) {
      prompt_tokens = chunk.usage.prompt_tokens;
      completion_tokens = chunk.usage.completion_tokens;
    }
  }

  logCall({
    trace_id: input.trace_id ?? "n/a",
    kind: "llm",
    model: MODEL,
    prompt_tokens,
    completion_tokens,
    latency_ms: Date.now() - t0,
    chunks_in: input.chunks.length,
  });
}

function buildSystemPrompt(repoName: string): string {
  return [
    `You are a code assistant for the repository "${repoName}".`,
    `Answer the user's question using ONLY the provided code excerpts.`,
    `Cite every claim with a tag in the exact form:`,
    `  [src: <path>#L<start>-L<end>]`,
    `Use the path and line range of the chunk you are citing. Do not invent paths.`,
    `If the answer is not in the excerpts, say "I don't see that in the indexed code."`,
    `Be terse. Prefer code snippets over prose. No preamble, no closing pleasantries.`,
  ].join("\n");
}

function buildUserPrompt(
  question: string,
  chunks: CitedAnswerInput["chunks"],
): string {
  const ctx = chunks
    .map((c, i) => {
      const sym = c.symbol ? ` ${c.symbol}` : "";
      return [
        `--- Chunk ${i + 1} ---`,
        `path: ${c.path}`,
        `lines: L${c.start_line}-L${c.end_line}${sym ? `  (${c.kind}: ${sym})` : ""}`,
        "```",
        c.text,
        "```",
      ].join("\n");
    })
    .join("\n\n");

  return `${ctx}\n\nQuestion: ${question}\n\nAnswer with citations.`;
}

function logCall(row: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");
}