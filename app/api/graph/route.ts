// GET /api/graph?repo_id=...
//   returns: { nodes: Array<{id, label, in_degree, out_degree, kind}>, edges: Array<{from, to, kind}> }
//
// The graph is built from the `edges` table we populate at ingest.
// Nodes are unique paths that appear in either side of an edge. We
// classify nodes as "internal" (path resolves to a file we ingested)
// or "external" (path starts with a node_modules specifier or
// python package name). The frontend colors them differently.

import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repoId = url.searchParams.get("repo_id");
  if (!repoId) return NextResponse.json({ ok: false, error: "repo_id required" }, { status: 400 });

  const conn = db();
  const edges = conn
    .prepare("SELECT from_path, to_path, kind FROM edges WHERE repo_id = ?")
    .all(repoId) as Array<{ from_path: string; to_path: string; kind: string }>;

  const internal = new Set<string>();
  const external = new Set<string>();
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const seenKinds = new Map<string, Set<string>>();

  for (const e of edges) {
    const fromInternal = isInternal(e.from_path);
    const toInternal = isInternal(e.to_path);
    if (fromInternal) internal.add(e.from_path);
    else external.add(e.from_path);
    if (toInternal) internal.add(e.to_path);
    else external.add(e.to_path);
    outDeg.set(e.from_path, (outDeg.get(e.from_path) ?? 0) + 1);
    inDeg.set(e.to_path, (inDeg.get(e.to_path) ?? 0) + 1);
    if (!seenKinds.has(e.from_path)) seenKinds.set(e.from_path, new Set());
    seenKinds.get(e.from_path)!.add(e.kind);
  }

  const nodes = [
    ...[...internal].map((id) => ({
      id,
      label: shortLabel(id),
      kind: "internal",
      in_degree: inDeg.get(id) ?? 0,
      out_degree: outDeg.get(id) ?? 0,
    })),
    ...[...external].map((id) => ({
      id,
      label: shortLabel(id),
      kind: "external",
      in_degree: inDeg.get(id) ?? 0,
      out_degree: outDeg.get(id) ?? 0,
    })),
  ];

  return NextResponse.json({ nodes, edges: edges.map((e) => ({ from: e.from_path, to: e.to_path, kind: e.kind })) });
}

function isInternal(path: string): boolean {
  // Heuristic: external specs don't start with "./" or "/" or "src/" etc.
  return /^[./]/.test(path) || /^[a-zA-Z0-9_./-]+\.[a-z]{2,4}$/.test(path);
}

function shortLabel(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}