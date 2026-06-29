// Live ingest trace API.
// GET /api/ingest/trace?repo_id=...
//   returns Server-Sent Events of ingest progress for the most recent
//   run. We store progress in a file-backed ring buffer so a fresh
//   page load can see what just happened. 100 lines max.
//
// For now this is a stub: we expose a static demo trace so the UI
// can render the panel. A real implementation would hook into
// lib/ingest.ts onProgress and write to the ring buffer.

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoId = url.searchParams.get("repo_id");

  // The trace we render in the UI is generated from the demo seed
  // we already have. Real ingest pushes here via lib/ingest.ts
  // onProgress callback. The shape of each event:
  //
  //   { ts, stage: "walking"|"chunking"|"embedding"|"done", msg, detail? }
  //
  // stages:
  //   walking:   walking the filesystem, found N files
  //   chunking:  emitting AST chunks per file
  //   embedding: sending batches of N chunks to MiniMax
  //   done:      final summary

  const demoTrace = [
    { ts: "12:01:15", stage: "walking", msg: "walking /Users/me/code/fresh", detail: { filesFound: 247 } },
    { ts: "12:01:16", stage: "chunking", msg: "src/server/router.ts", detail: { chunks: 4, symbols: ["FreshRouter", "matchRoute", "defineRoute", "routerHandler"] } },
    { ts: "12:01:16", stage: "chunking", msg: "src/server/context.ts", detail: { chunks: 6, symbols: ["FreshContext", "buildContext", "mergeContexts", "requestState", "respond", "errorResponse"] } },
    { ts: "12:01:16", stage: "chunking", msg: "src/server/render.ts", detail: { chunks: 3, symbols: ["renderRoute", "renderToString", "wrapInErrorBoundary"] } },
    { ts: "12:01:17", stage: "chunking", msg: "src/server/middleware.ts", detail: { chunks: 2, symbols: ["composeMiddleware", "runMiddlewareChain"] } },
    { ts: "12:01:17", stage: "chunking", msg: "src/server/types.ts", detail: { chunks: 8, symbols: ["Handler", "HandlerByMethod", "FreshConfig", "Manifest", "Route", "Island", "MiddlewareHandlerContext", "AppModule"] } },
    { ts: "12:01:17", stage: "chunking", msg: "src/runtime/jsx.ts", detail: { chunks: 4, symbols: ["JSXNode", "jsx", "jsxs", "Fragment"] } },
    { ts: "12:01:18", stage: "chunking", msg: "src/runtime/preact_hooks.ts", detail: { chunks: 5, symbols: ["useState", "useEffect", "useSignal", "useComputed", "islandBootstrap"] } },
    { ts: "12:01:18", stage: "chunking", msg: "src/build/mod.ts", detail: { chunks: 3, symbols: ["buildManifest", "writeBuildOutput", "emitAssetManifest"] } },
    { ts: "12:01:19", stage: "chunking", msg: "src/build/esbuild.ts", detail: { chunks: 4, symbols: ["configureEsbuild", "buildIslands", "buildServer", "resolveImportMap"] } },
    { ts: "12:01:19", stage: "chunking", msg: "src/dev/commands.ts", detail: { chunks: 7, symbols: ["start", "build", "manifest", "check", "fmt", "init", "upgrade"] } },
    { ts: "12:01:20", stage: "embedding", msg: "batch 1/16 (32 chunks) -> MiniMax-Text-01", detail: { tokens: 24000, latency_ms: 1840 } },
    { ts: "12:01:22", stage: "embedding", msg: "batch 2/16 (32 chunks)", detail: { tokens: 24800, latency_ms: 1790 } },
    { ts: "12:01:23", stage: "embedding", msg: "batch 3/16 (32 chunks)", detail: { tokens: 23100, latency_ms: 1820 } },
    { ts: "12:01:25", stage: "embedding", msg: "batch 4/16 (32 chunks)", detail: { tokens: 25600, latency_ms: 1910 } },
    { ts: "12:01:27", stage: "embedding", msg: "batch 5/16 (32 chunks)", detail: { tokens: 22900, latency_ms: 1750 } },
    { ts: "12:01:28", stage: "embedding", msg: "batch 6/16 (32 chunks)", detail: { tokens: 24200, latency_ms: 1820 } },
    { ts: "12:01:30", stage: "embedding", msg: "batch 7/16 (32 chunks)", detail: { tokens: 23500, latency_ms: 1780 } },
    { ts: "12:01:32", stage: "embedding", msg: "batch 8/16 (32 chunks)", detail: { tokens: 24400, latency_ms: 1810 } },
    { ts: "12:01:33", stage: "embedding", msg: "batch 9/16 (32 chunks)", detail: { tokens: 22800, latency_ms: 1760 } },
    { ts: "12:01:35", stage: "embedding", msg: "batch 10/16 (32 chunks)", detail: { tokens: 25100, latency_ms: 1870 } },
    { ts: "12:01:37", stage: "embedding", msg: "batch 11/16 (32 chunks)", detail: { tokens: 23900, latency_ms: 1820 } },
    { ts: "12:01:38", stage: "embedding", msg: "batch 12/16 (32 chunks)", detail: { tokens: 24600, latency_ms: 1840 } },
    { ts: "12:01:40", stage: "embedding", msg: "batch 13/16 (32 chunks)", detail: { tokens: 23200, latency_ms: 1790 } },
    { ts: "12:01:42", stage: "embedding", msg: "batch 14/16 (32 chunks)", detail: { tokens: 24800, latency_ms: 1820 } },
    { ts: "12:01:43", stage: "embedding", msg: "batch 15/16 (32 chunks)", detail: { tokens: 24100, latency_ms: 1810 } },
    { ts: "12:01:45", stage: "embedding", msg: "batch 16/16 (12 chunks)", detail: { tokens: 9800, latency_ms: 1120 } },
    { ts: "12:01:46", stage: "done", msg: "ingest complete", detail: { files: 247, chunks: 524, edges: 312, duration_ms: 31042 } },
  ];

  return NextResponse.json({ repo_id: repoId, trace: demoTrace });
}