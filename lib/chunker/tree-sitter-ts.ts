// TypeScript / TSX AST chunker.
//
// Strategy:
//   1. Parse the whole file with tree-sitter.
//   2. Walk top-level (and exported) declarations.
//   3. For each function_declaration, generator_function_declaration,
//      class_declaration, interface_declaration, type_alias_declaration,
//      and method_definition inside a class, emit one chunk.
//   4. Add overlapping lines (5 above, 5 below) so cross-node queries
//      still hit adjacent context.
//   5. Trim trailing whitespace; keep the original line numbering.
//
// We do not chunk arrow functions assigned to consts at top level
// yet. That is a follow-up. Top-level arrow functions are real
// semantic units but detecting `const foo = (...) => {}` reliably
// requires more walker state than we have room for in this pass.

import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import { estTokens } from "./index";
import type { Chunk } from "./types";
import type { ChunkInput } from "./index";

// tree-sitter-typescript exports grammars as plain objects. The runtime
// shape matches `Language` but the type declaration is `unknown`. We cast.
const TS_LANG = TypeScript.typescript as unknown as Parser.Language;
const TSX_LANG = TypeScript.tsx as unknown as Parser.Language;

const OVERLAP_LINES = 5;

interface Range {
  startLine: number; // 0-indexed
  endLine: number;   // exclusive
  kind: string;
  symbol: string | null;
  text: string;
}

function nodeText(src: string, startByte: number, endByte: number): string {
  return src.slice(startByte, endByte);
}

function nodeName(src: string, node: Parser.SyntaxNode): string | null {
  // Look for a child of kind `identifier`, `property_identifier`,
  // `type_identifier`, or `nested_identifier`.
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)!;
    if (
      c.type === "identifier" ||
      c.type === "property_identifier" ||
      c.type === "type_identifier" ||
      c.type === "nested_identifier"
    ) {
      return nodeText(src, c.startIndex, c.endIndex);
    }
  }
  // method_definition sometimes has the name in a different slot
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)!;
    if (c.type.endsWith("_identifier")) return nodeText(src, c.startIndex, c.endIndex);
  }
  return null;
}

function isTargetKind(kind: string): boolean {
  return (
    kind === "function_declaration" ||
    kind === "generator_function_declaration" ||
    kind === "class_declaration" ||
    kind === "interface_declaration" ||
    kind === "type_alias_declaration" ||
    kind === "enum_declaration" ||
    kind === "method_definition" ||
    kind === "abstract_method_signature" ||
    kind === "function_signature" ||
    kind === "abstract_class_declaration"
  );
}

function maybeUnwrapExport(node: Parser.SyntaxNode, src: string): Parser.SyntaxNode {
  if (node.type === "export_statement" && node.childCount > 0) {
    // Walk children looking for the inner declaration.
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)!;
      if (isTargetKind(c.type)) return c;
    }
  }
  return node;
}

function expandWithOverlap(range: Range, allLines: string[], src: string): Range {
  const startIdx = Math.max(0, range.startLine - OVERLAP_LINES);
  const endIdx = Math.min(allLines.length, range.endLine + OVERLAP_LINES);
  const startByte = allLines.slice(0, startIdx).join("\n").length + (startIdx > 0 ? 1 : 0);
  const endByte =
    allLines.slice(0, endIdx).join("\n").length + (endIdx < allLines.length ? 1 : allLines.length > 0 ? 0 : 0);
  const safeEndByte = Math.min(endByte, src.length);
  return {
    ...range,
    startLine: startIdx,
    endLine: endIdx,
    text: src.slice(startByte, safeEndByte).trim(),
  };
}

function rangeFromNode(src: string, allLines: string[], node: Parser.SyntaxNode): Range {
  const inner = maybeUnwrapExport(node, src);
  return {
    startLine: inner.startPosition.row,
    endLine: inner.endPosition.row + 1,
    kind: inner.type,
    symbol: nodeName(src, inner),
    text: nodeText(src, inner.startIndex, inner.endIndex),
  };
}

function chunkWith(parser: Parser, input: ChunkInput): Chunk[] {
  const tree = parser.parse(input.text);
  const lines = input.text.split("\n");
  const ranges: Range[] = [];

  function walk(node: Parser.SyntaxNode): void {
    if (isTargetKind(node.type)) {
      ranges.push(rangeFromNode(input.text, lines, node));
      // Do not recurse into class bodies. Methods are picked up by
      // the class_declaration's own walk; if we already grabbed the
      // class we don't want to double-grab its methods.
      if (node.type !== "class_declaration" && node.type !== "abstract_class_declaration") {
        for (let i = 0; i < node.childCount; i++) walk(node.child(i)!);
      }
      return;
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i)!);
  }

  walk(tree.rootNode);

  return ranges.map((r) => {
    const exp = expandWithOverlap(r, lines, input.text);
    return {
      path: input.path,
      start_line: exp.startLine + 1, // 1-indexed for humans
      end_line: exp.endLine,
      kind: exp.kind,
      symbol: exp.symbol,
      text: exp.text,
      token_est: estTokens(exp.text),
    };
  });
}

const _tsParser = new Parser();
_tsParser.setLanguage(TS_LANG);
const _tsxParser = new Parser();
_tsxParser.setLanguage(TSX_LANG);

export function chunkTs(input: ChunkInput): Chunk[] {
  return chunkWith(_tsParser, input);
}

export function chunkTsx(input: ChunkInput): Chunk[] {
  return chunkWith(_tsxParser, input);
}