// Chunker dispatcher. Picks the right tree-sitter grammar based on
// file extension and falls back to sliding-window chunking for
// languages we don't support yet (or anything tree-sitter chokes on).
//
// We intentionally do NOT chunk every file: small files (< 200 tokens)
// are stored as a single chunk to keep semantic units intact. Very
// large files that produce zero AST chunks fall through to fallback.

import { extname } from "node:path";
import { chunkTs, chunkTsx } from "./tree-sitter-ts";
import { chunkPy } from "./tree-sitter-py";
import { chunkFallback } from "./fallback";
import type { Chunk } from "./types";

export type { Chunk } from "./types";

const TS_EXTS = new Set([".ts", ".mts", ".cts", ".tsx"]);
const PY_EXTS = new Set([".py", ".pyi"]);

export interface ChunkInput {
  path: string;
  text: string;
}

export function chunkFile(input: ChunkInput): Chunk[] {
  const ext = extname(input.path).toLowerCase();
  if (TS_EXTS.has(ext)) {
    const chunks = ext === ".tsx" ? chunkTsx(input) : chunkTs(input);
    if (chunks.length > 0) return chunks;
  }
  if (PY_EXTS.has(ext)) {
    const chunks = chunkPy(input);
    if (chunks.length > 0) return chunks;
  }
  return chunkFallback(input);
}

// Rough token estimate: 1 token per ~4 chars of code. Used only for
// logging and the eval score; the LLM call counts real tokens.
export function estTokens(text: string): number {
  return Math.ceil(text.length / 4);
}