"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { ReactFlowProvider, useReactFlow, type Node, type Edge } from "reactflow";
import dynamic from "next/dynamic";

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

// Layout canvas is intentionally much bigger than the panel.
// fitView zooms out to whatever bounds we give it. Bigger layout
// canvas = nodes spaced further apart = labels don't overlap after zoom.
const LAYOUT_W = 2400;
const LAYOUT_H = 1600;
const MIN_DIST = 220;       // nodes repel each other below this distance
const EDGE_LEN = 280;       // attractive force pulls edges to this length
const ITERATIONS = 320;

// Deterministic-ish PRNG so layout doesn't reshuffle on every render.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function forceLayout(data: GraphData): PositionedNode[] {
  const out: PositionedNode[] = data.nodes.map((n) => ({
    ...n,
    x: LAYOUT_W / 2,
    y: LAYOUT_H / 2,
  }));
  const byId = new Map(out.map((n) => [n.id, n]));

  // Seed positions: internals in a tight cluster at center, externals spread out.
  const rand = seeded(42);
  const internals = out.filter((n) => n.kind === "internal");
  const externals = out.filter((n) => n.kind === "external");
  internals.forEach((n, i) => {
    n.x = LAYOUT_W / 2 + Math.cos((i / internals.length) * Math.PI * 2) * 80;
    n.y = LAYOUT_H / 2 + Math.sin((i / internals.length) * Math.PI * 2) * 80;
  });
  externals.forEach((n, i) => {
    n.x = LAYOUT_W / 2 + Math.cos((i / externals.length) * Math.PI * 2) * 500;
    n.y = LAYOUT_H / 2 + Math.sin((i / externals.length) * Math.PI * 2) * 500 + (rand() - 0.5) * 30;
  });

  // Verlet-ish relaxation.
  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Repulsion between every pair (O(n^2) but n is small).
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const force = (MIN_DIST - d) * 0.5;
        if (force <= 0) continue;
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.x -= fx;
        a.y -= fy;
        b.x += fx;
        b.y += fy;
      }
    }
    // Attraction along edges (spring toward EDGE_LEN).
    for (const e of data.edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const force = (d - EDGE_LEN) * 0.04;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.x += fx;
      a.y += fy;
      b.x -= fx;
      b.y -= fy;
    }
    // Gentle pull toward center so disconnected nodes don't drift off.
    for (const n of out) {
      n.x += (LAYOUT_W / 2 - n.x) * 0.002;
      n.y += (LAYOUT_H / 2 - n.y) * 0.002;
    }
  }

  return out;
}

export default function ArchitectureMap(props: { activeRepoId: string | null }) {
  return (
    <ReactFlowProvider>
      <ArchitectureMapInner {...props} />
    </ReactFlowProvider>
  );
}

function ArchitectureMapInner({ activeRepoId }: { activeRepoId: string | null }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();

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

  // Re-fit whenever data loads. Layout uses a fixed-size canvas, so
  // panel resize doesn't change node positions.
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => fitView({ duration: 300, padding: 0.15 }), 100);
    return () => clearTimeout(t);
  }, [data, fitView]);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    const positioned = forceLayout(data);
    const nodes: Node[] = positioned.map((n) => ({
      id: n.id,
      position: { x: n.x, y: n.y },
      // Short label (no degree suffix). Title attr shows full info on hover.
      data: { label: n.label },
      title: `${n.label}\nin: ${n.in_degree}  out: ${n.out_degree}  ${n.kind}`,
      style: {
        background: n.kind === "internal" ? "var(--bg-elev2)" : "var(--bg)",
        color: n.kind === "internal" ? "var(--fg)" : "var(--fg-muted)",
        border: n.kind === "internal" ? "1.5px solid var(--accent)" : "1px dashed var(--border)",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: n.kind === "internal" ? 600 : 400,
        padding: "5px 10px",
        fontFamily: "var(--mono)",
        width: "auto",
        whiteSpace: "nowrap",
        boxShadow: n.kind === "internal" ? "0 0 0 1px rgba(88,166,255,0.15)" : "none",
      },
    }));
    const edges: Edge[] = data.edges.slice(0, 300).map((e, i) => ({
      id: `${i}-${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      style: { stroke: "var(--border)", strokeWidth: 1, opacity: 0.7 },
      type: "default",
    }));
    return { nodes, edges };
  }, [data]);

  if (!activeRepoId) return <div className="muted">Ingest a repo to see its dependency graph.</div>;
  if (loading) return <div className="muted">Loading graph...</div>;
  if (!data || data.nodes.length === 0) return <div className="muted">No edges recorded.</div>;

  return (
    <div className="graph-host" ref={containerRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2.5}
        nodesDraggable={true}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        fitView
      >
        <Background gap={20} size={1} color="rgba(139, 148, 158, 0.15)" />
        <Controls />
      </ReactFlow>
      <div className="graph-legend">
        <span className="legend-item">
          <span className="legend-swatch internal" /> internal ({data.nodes.filter((n) => n.kind === "internal").length})
        </span>
        <span className="legend-item">
          <span className="legend-swatch external" /> external ({data.nodes.filter((n) => n.kind === "external").length})
        </span>
        <span className="muted">{data.edges.length} edges</span>
      </div>
    </div>
  );
}