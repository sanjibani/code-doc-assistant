// Unit tests for the chunker. Runs with `pnpm test` (tsx --test).
// These do not need a DB or an API key. They verify the AST
// chunker produces sane output for representative inputs.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { chunkFile } from "./chunker/index";
import { chunkFallback } from "./chunker/fallback";
import { packEmbedding, unpackEmbedding } from "./db/client";
import { fakeEmbedForSeed } from "./fake-embed";

test("chunker emits one chunk per TS class", () => {
  const text = `
export class AuthService {
  login(user) { return user.id; }
  logout() { this.jwt = ""; }
}
`;
  const chunks = chunkFile({ path: "auth.ts", text });
  const classChunks = chunks.filter((c) => c.kind === "class_declaration");
  assert.equal(classChunks.length, 1);
  assert.equal(classChunks[0]!.symbol, "AuthService");
});

test("chunker emits one chunk per TS function_declaration", () => {
  const text = `
export function hashPassword(pw: string): string {
  return sha256(pw);
}
export function validateToken(t: string): boolean {
  return t.length > 0;
}
`;
  const chunks = chunkFile({ path: "x.ts", text });
  const fnChunks = chunks.filter((c) => c.kind === "function_declaration");
  assert.equal(fnChunks.length, 2);
  const symbols = fnChunks.map((c) => c.symbol).sort();
  assert.deepEqual(symbols, ["hashPassword", "validateToken"]);
});

test("chunker emits one chunk per Python function_definition", () => {
  const text = `
def greet(name: str) -> str:
    return f"hello {name}"

def farewell(name: str) -> str:
    return f"bye {name}"
`;
  const chunks = chunkFile({ path: "x.py", text });
  const fnChunks = chunks.filter((c) => c.kind === "function_definition");
  assert.equal(fnChunks.length, 2);
  const symbols = fnChunks.map((c) => c.symbol).sort();
  assert.deepEqual(symbols, ["farewell", "greet"]);
});

test("chunker applies 5-line overlap on each side", () => {
  // 50 lines of code, one function spanning lines 10-20.
  const lines = Array.from({ length: 50 }, (_, i) => `// line ${i + 1}`);
  lines[9] = "export function middle() {";
  lines[19] = "}";
  const text = lines.join("\n");
  const chunks = chunkFile({ path: "x.ts", text });
  assert.equal(chunks.length, 1);
  // start_line should be < 10 (overlap above)
  assert.ok(chunks[0]!.start_line < 10, `start_line was ${chunks[0]!.start_line}`);
  // end_line should be > 20 (overlap below)
  assert.ok(chunks[0]!.end_line > 20, `end_line was ${chunks[0]!.end_line}`);
});

test("chunker fallback returns one chunk for small files", () => {
  const text = "hello world\n".repeat(50);
  const chunks = chunkFallback({ path: "x.txt", text });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.kind, "file");
});

test("packEmbedding roundtrips exactly", () => {
  const dim = 1536;
  const arr = Array.from({ length: dim }, (_, i) => Math.sin(i * 0.01));
  const buf = packEmbedding(arr);
  assert.equal(buf.length, dim * 4);
  const back = unpackEmbedding(buf);
  for (let i = 0; i < dim; i++) {
    assert.ok(Math.abs(arr[i]! - back[i]!) < 1e-6, `mismatch at ${i}`);
  }
});

test("fakeEmbedForSeed is deterministic and varies with input", () => {
  process.env.EMBEDDING_DIM = "8";
  const a1 = fakeEmbedForSeed("AuthService");
  const a2 = fakeEmbedForSeed("AuthService");
  const b = fakeEmbedForSeed("OtherClass");
  assert.deepEqual(a1, a2, "same input must produce same vector");
  assert.notDeepEqual(a1, b, "different input must produce different vector");
  // Cosine similarity between distinct inputs is small but not zero
  // (deterministic hash). We just assert not equal.
});