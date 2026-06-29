// Python AST chunker. Mirrors the TypeScript chunker:
//   function_definition, class_definition, decorated_definition (unwrap)
//   + same OVERLAP_LINES overlap.

import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import { estTokens } from "./index";
import type { Chunk } from "./types";
import type { ChunkInput } from "./index";

const PY_LANG = Python as unknown as Parser.Language;

const OVERLAP_LINES = 5;

function isTargetKind(kind: string): boolean {
  return (
    kind === "function_definition" ||
    kind === "class_definition" ||
    kind === "decorated_definition"
  );
}

function unwrapDecorated(node: Parser.SyntaxNode): Parser.SyntaxNode {
  if (node.type === "decorated_definition") {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)!;
      if (isTargetKind(c.type)) return c;
    }
  }
  return node;
}

function nodeName(node: Parser.SyntaxNode): string | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)!;
    if (c.type === "identifier") return c.text;
  }
  return null;
}

function expand(src: string, lines: string[], startLine: number, endLine: number, inner: string): string {
  const a = Math.max(0, startLine - OVERLAP_LINES);
  const b = Math.min(lines.length, endLine + OVERLAP_LINES);
  const startByte = a === 0 ? 0 : lines.slice(0, a).join("\n").length + 1;
  const endByte = b >= lines.length ? src.length : lines.slice(0, b).join("\n").length + 1;
  return src.slice(startByte, Math.min(endByte, src.length)).trim();
}

const _parser = new Parser();
_parser.setLanguage(PY_LANG);

export function chunkPy(input: ChunkInput): Chunk[] {
  const tree = _parser.parse(input.text);
  const lines = input.text.split("\n");
  const out: Chunk[] = [];

  function walk(node: Parser.SyntaxNode): void {
    if (isTargetKind(node.type)) {
      const inner = unwrapDecorated(node);
      const text = expand(input.text, lines, inner.startPosition.row, inner.endPosition.row + 1, inner.text);
      out.push({
        path: input.path,
        start_line: Math.max(0, inner.startPosition.row - OVERLAP_LINES) + 1,
        end_line: Math.min(lines.length, inner.endPosition.row + 1 + OVERLAP_LINES),
        kind: inner.type,
        symbol: nodeName(inner),
        text,
        token_est: estTokens(text),
      });
      if (inner.type !== "class_definition") {
        for (let i = 0; i < inner.childCount; i++) walk(inner.child(i)!);
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i)!);
  }

  walk(tree.rootNode);
  return out;
}