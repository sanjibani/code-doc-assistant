// Sliding-window chunker fallback. Used for languages we don't have
// a tree-sitter grammar for, or files that produced zero AST chunks
// (very small files are intentionally skipped here; we still chunk
// them once at the file level so they're searchable).
//
// Defaults: 800 tokens target, 100 token overlap.

import { estTokens } from "./index";
import type { Chunk } from "./types";
import type { ChunkInput } from "./index";

const TARGET_TOKENS = 800;
const OVERLAP_TOKENS = 100;
const TARGET_CHARS = TARGET_TOKENS * 4;
const OVERLAP_CHARS = OVERLAP_TOKENS * 4;

export function chunkFallback(input: ChunkInput): Chunk[] {
  const text = input.text;
  if (text.trim().length === 0) return [];
  if (text.length <= TARGET_CHARS) {
    return [singleChunk(input, 1, text.split("\n").length, text)];
  }
  const out: Chunk[] = [];
  let cursor = 0;
  const lines = text.split("\n");
  let lineCursor = 0;
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + TARGET_CHARS);
    const startLine = lineCursor + 1;
    const sliceLines = lines.slice(lineCursor, Math.ceil(end / 50));
    const endLine = lineCursor + sliceLines.length;
    out.push(singleChunk(input, startLine, Math.min(endLine, lines.length), text.slice(cursor, end)));
    if (end >= text.length) break;
    cursor = end - OVERLAP_CHARS;
    lineCursor = countLinesBefore(text, cursor);
  }
  return out;
}

function singleChunk(input: ChunkInput, startLine: number, endLine: number, text: string): Chunk {
  return {
    path: input.path,
    start_line: startLine,
    end_line: Math.max(endLine, startLine),
    kind: "file",
    symbol: null,
    text: text.trim(),
    token_est: estTokens(text),
  };
}

function countLinesBefore(text: string, charIdx: number): number {
  let n = 0;
  for (let i = 0; i < charIdx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}