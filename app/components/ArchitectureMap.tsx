"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

// react-flow must run client-side only. Dynamic import avoids SSR issues.
const ReactFlow = dynamic(() => import("reactflow").then((m) => m.default), { ssr: false });
const Background = dynamic(() => import("reactflow").then((m) => m.Background), { ssr: false });
const Controls = dynamic(() => import("reactflow").then((m) => m.Controls), { ssr: false });

import "reactflow/dist/style.css";

interface GraphData {
  nodes: Array<{ id: string; label: string; kind: "internal" | "external"; in_degree: number; out_degree: number }>;
  edges: Array<{ from: string; to: string; kind: string }>;
}

interface PositionedNode {
  id: string;
  label: string;
  kind: "internal" | "external";
  in_degree: number;
  out_degree: number;
  x: number;
  y: number;
}

export default function ArchitectureMap({ activeRepoId }: { activeRepoId: string | null }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeRepoId) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/graph?repo_id=${encodeURIComponent(activeRepoId)}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [activeRepoId]);

  if (!activeRepoId) return <div className="muted">Ingest a repo to see its dependency graph.</div>;
  if (loading) return <div className="muted">Loading graph...</div>;
  if (!data || data.nodes.length === 0) return <div className="muted">No edges recorded.</div>;

  const positioned = layout(data);
  const flowNodes = positioned.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: `${n.label} (${n.in_degree}/${n.out_degree})` },
    style: {
      background: n.kind === "internal" ? "var(--bg-elev2)" : "var(--bg)",
      color: n.kind === "internal" ? "var(--fg)" : "var(--fg-muted)",
      border: n.kind === "internal" ? "1px solid var(--accent)" : "1px dashed var(--border)",
      borderRadius: 6,
      fontSize: 11,
      padding: "4px 8px",
      fontFamily: "var(--mono)",
      width: "auto",
    },
  }));
  const flowEdges = data.edges.slice(0, 200).map((e, i) => ({
    id: `${i}-${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    style: { stroke: "var(--border)", strokeWidth: 1 },
  }));

  return (
    <div className="graph-host" ref={containerRef} style={{ height: 360 }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
      </ReactFlow>
      <div className="muted" style={{ marginTop: 8 }}>
        {data.nodes.length} nodes / {data.edges.length} edges
      </div>
    </div>
  );
}

// Tiny force-directed-ish layout. Not great, but no external dep.
function layout(data: GraphData): PositionedNode[] {
  const out: PositionedNode[] = [];
  const byId = new Map<string, PositionedNode>();
  for (const n of data.nodes) {
    const node: PositionedNode = { ...n, x: 0, y: 0 };
    byId.set(n.id, node);
    out.push(node);
  }
  // Radial: internals on inner ring, externals on outer ring.
  const internals = out.filter((n) => n.kind === "internal");
  const externals = out.filter((n) => n.kind === "external");
  const cx = 200;
  const cy = 160;
  internals.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(internals.length, 1);
    n.x = cx + Math.cos(angle) * 80;
    n.y = cy + Math.sin(angle) * 80;
  });
  externals.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(externals.length, 1);
    n.x = cx + Math.cos(angle) * 150;
    n.y = cy + Math.sin(angle) * 150;
  });
  return out;
}