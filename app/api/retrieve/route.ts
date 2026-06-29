// Retrieval trace. Returns the top-K chunks that hybrid search
// would return for a given question, BEFORE the LLM is called.
// This is what the user clicks to see "why did the system pick
// these particular chunks."
//
// In production this route would actually run hybrid search and
// return the FusedHit[] directly. For the demo we return a
// precomputed example trace that mirrors what the system would
// produce for the question "how does routing work?" against a
// deno/fresh-style codebase.
//
// The shape matches lib/search/hybrid.ts FusedHit so the UI can
// render it without modification.

import { NextResponse } from "next/server";

const EXAMPLE = {
  question: "how does routing work?",
  bm25: [
    { rank: 1, path: "src/server/router.ts", lines: "L42-L89", symbol: "matchRoute", score: 4.21 },
    { rank: 2, path: "src/server/router.ts", lines: "L1-L41", symbol: "FreshRouter", score: 2.89 },
    { rank: 3, path: "src/server/types.ts", lines: "L120-L148", symbol: "Route", score: 1.95 },
    { rank: 4, path: "src/server/render.ts", lines: "L15-L52", symbol: "renderRoute", score: 1.42 },
    { rank: 5, path: "src/server/middleware.ts", lines: "L8-L34", symbol: "runMiddlewareChain", score: 0.88 },
    { rank: 6, path: "src/build/mod.ts", lines: "L78-L120", symbol: "buildManifest", score: 0.71 },
    { rank: 7, path: "src/runtime/jsx.ts", lines: "L1-L30", symbol: "jsx", score: 0.34 },
    { rank: 8, path: "src/dev/commands.ts", lines: "L120-L180", symbol: "start", score: 0.21 },
  ],
  vector: [
    { rank: 1, path: "src/server/router.ts", lines: "L42-L89", symbol: "matchRoute", sim: 0.91 },
    { rank: 2, path: "src/server/render.ts", lines: "L15-L52", symbol: "renderRoute", sim: 0.86 },
    { rank: 3, path: "src/server/router.ts", lines: "L1-L41", symbol: "FreshRouter", sim: 0.79 },
    { rank: 4, path: "src/server/types.ts", lines: "L120-L148", symbol: "Route", sim: 0.74 },
    { rank: 5, path: "src/server/context.ts", lines: "L1-L45", symbol: "FreshContext", sim: 0.68 },
    { rank: 6, path: "src/build/mod.ts", lines: "L78-L120", symbol: "buildManifest", sim: 0.61 },
    { rank: 7, path: "src/server/middleware.ts", lines: "L8-L34", symbol: "runMiddlewareChain", sim: 0.55 },
    { rank: 8, path: "src/server/types.ts", lines: "L60-L100", symbol: "Handler", sim: 0.49 },
  ],
  fused: [
    { rank: 1, path: "src/server/router.ts", lines: "L42-L89", symbol: "matchRoute", rrf: 0.0328, bm25_rank: 1, vec_rank: 1, in_both: true, picked: true },
    { rank: 2, path: "src/server/router.ts", lines: "L1-L41", symbol: "FreshRouter", rrf: 0.0303, bm25_rank: 2, vec_rank: 3, in_both: true, picked: true },
    { rank: 3, path: "src/server/render.ts", lines: "L15-L52", symbol: "renderRoute", rrf: 0.0298, bm25_rank: 4, vec_rank: 2, in_both: true, picked: true },
    { rank: 4, path: "src/server/types.ts", lines: "L120-L148", symbol: "Route", rrf: 0.0279, bm25_rank: 3, vec_rank: 4, in_both: true, picked: true },
    { rank: 5, path: "src/server/middleware.ts", lines: "L8-L34", symbol: "runMiddlewareChain", rrf: 0.0246, bm25_rank: 5, vec_rank: 7, in_both: true, picked: true },
    { rank: 6, path: "src/server/context.ts", lines: "L1-L45", symbol: "FreshContext", rrf: 0.0164, bm25_rank: null, vec_rank: 5, in_both: false, picked: true },
    { rank: 7, path: "src/build/mod.ts", lines: "L78-L120", symbol: "buildManifest", rrf: 0.0240, bm25_rank: 6, vec_rank: 6, in_both: true, picked: true },
    { rank: 8, path: "src/server/types.ts", lines: "L60-L100", symbol: "Handler", rrf: 0.0161, bm25_rank: null, vec_rank: 8, in_both: false, picked: true },
  ],
  explanation: {
    bm25_winner: "matchRoute — keyword match on 'routing'/'route'",
    vector_winner: "matchRoute — semantic match: routing == url dispatch",
    rrf_promoted: "FreshContext — appeared only in vector (semantic match, no literal 'route' keyword). RRF still picked it because vec_rank=5 is strong.",
    dropped_for_llm: "jsx, start, buildManifest (lower ranks)",
  },
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const question = url.searchParams.get("q") ?? "how does routing work?";
  return NextResponse.json({ question, ...EXAMPLE });
}