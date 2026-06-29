// MiniMax embeddings client. Despite what older docs say, the
// MiniMax embeddings endpoint is NOT OpenAI-compatible:
//   - request body uses `texts: string[]` (not `input`)
//   - request body requires `type: "db" | "query"`
//   - response uses `vectors: number[][]` (not `data: [{embedding}]`)
// We talk to it via raw fetch instead of the openai SDK.
//
// `type: "db"` is for content you're going to store and search over.
// `type: "query"` is for user questions at retrieval time. MiniMax
// recommends using `query` for live queries and `db` for indexed
// content (asymmetric retrieval). Both produce the same dim vector.
//
// Stderr log line per call: ts, trace_id, kind, model, prompt_tokens,
// latency_ms, n_inputs.

import { fakeEmbedForSeed } from "./fake-embed";

const ENDPOINT = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
const MODEL = process.env.MINIMAX_EMBEDDING_MODEL ?? "embedding-2";

function authHeaders(): Record<string, string> {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("MINIMAX_API_KEY is required. Set it in .env");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export interface EmbedCall {
  inputs: string[];
  type?: "db" | "query";
  trace_id?: string;
}

export interface EmbedResult {
  embeddings: number[][];
  prompt_tokens: number;
  latency_ms: number;
  model: string;
}

export async function embed({ inputs, type = "db", trace_id }: EmbedCall): Promise<EmbedResult> {
  // Truncate anything ridiculous. Most embedding models cap at 8k
  // tokens; 24k chars is a generous safety.
  const safe = inputs.map((s) => (s.length > 24_000 ? s.slice(0, 24_000) : s));
  const t0 = Date.now();
  const resp = await fetch(`${ENDPOINT}/embeddings`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ model: MODEL, texts: safe, type }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`MiniMax embeddings ${resp.status}: ${text.slice(0, 500)}`);
  }
  const data = (await resp.json()) as {
    vectors: number[][] | null;
    base_resp?: { status_code: number; status_msg: string };
  };
  if (data.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax embeddings error ${data.base_resp.status_code}: ${data.base_resp.status_msg}`);
  }
  if (!data.vectors) {
    throw new Error("MiniMax embeddings returned no vectors (likely rate-limited; try again in a minute)");
  }
  const embeddings = data.vectors;
  const prompt_tokens = safe.reduce((acc, s) => acc + Math.ceil(s.length / 4), 0);
  const latency_ms = Date.now() - t0;
  logCall({
    trace_id: trace_id ?? "n/a",
    kind: "embed",
    model: MODEL,
    prompt_tokens,
    completion_tokens: 0,
    latency_ms,
    n_inputs: safe.length,
    type,
  });
  return { embeddings, prompt_tokens, latency_ms, model: MODEL };
}

// One-call wrapper. Used at retrieval time. type=query because the
// query vector should be slightly tuned differently than the
// indexed vectors (asymmetric retrieval).
//
// Falls back to a deterministic fake embedding if EMBED_FAKE=1 is
// set. This is for demos and screenshots when the real API is
// rate-limited. The fake vectors are seeded from the input string,
// so similar strings produce similar vectors.
export async function embedOne(text: string, trace_id?: string): Promise<number[]> {
  if (process.env.EMBED_FAKE === "1") return fakeEmbed(text);
  const r = await embed({ inputs: [text], type: "query", trace_id });
  return r.embeddings[0]!;
}

// Deterministic embedding derived from the input text. Useful when
// the real MiniMax endpoint is rate-limited. Not suitable for
// production — these vectors carry no semantic meaning.
function fakeEmbed(text: string): number[] {
  return fakeEmbedForSeed(text);
}

// Embed N strings in batches. Used at ingest time. type=db.
export async function embedBatched(
  inputs: string[],
  opts: { batchSize?: number; trace_id?: string; onProgress?: (done: number, total: number) => void } = {},
): Promise<number[][]> {
  if (process.env.EMBED_FAKE === "1") {
    opts.onProgress?.(inputs.length, inputs.length);
    return inputs.map(fakeEmbed);
  }
  const batchSize = opts.batchSize ?? 16; // MiniMax rate limits kick in around 32; 16 is safe.
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const r = await embed({ inputs: batch, type: "db", trace_id: opts.trace_id });
    out.push(...r.embeddings);
    opts.onProgress?.(Math.min(i + batch.length, inputs.length), inputs.length);
  }
  return out;
}

function logCall(row: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");
}