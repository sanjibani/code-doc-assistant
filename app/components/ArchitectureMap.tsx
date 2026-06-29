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

// Layout uses a deterministic grid + ring scheme sized to the container.
// Nodes never leave this box, so fitView can always find the bounds.
function layout(data: GraphData, containerW: number, containerH: number): PositionedNode[] {
  const cx = containerW / 2;
  const cy = containerH / 2;
  const w = Math.max(containerW, 400);
  const h = Math.max(containerH, 400);

  const out: PositionedNode[] = data.nodes.map((n) => ({ ...n, x: cx, y: cy }));
  const byId = new Map(out.map((n) => [n.id, n]));
  const internals = out.filter((n) => n.kind === "internal");
  const externals = out.filter((n) => n.kind === "external");

  // Grid: 3 cols x ceil(N/3) rows, centered around (cx, cy).
  const cols = 3;
  const colW = 130;
  const rowH = 36;
  const rows = Math.ceil(internals.length / cols);
  const gridW = cols * colW;
  const gridH = rows * rowH;
  const gx0 = cx - gridW / 2 + colW / 2;
  const gy0 = cy - gridH / 2 + rowH / 2;
  // Sort internals by out_degree desc so the hub files (sandbox.py etc.) sit on top.
  internals.sort((a, b) => b.out_degree - a.out_degree);
  internals.forEach((n, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    n.x = gx0 + c * colW;
    n.y = gy0 + r * rowH;
  });

  // Ring around the grid for externals. Bigger radius if more externals.
  const ringR = Math.min(w, h) * 0.42;
  externals.sort((a, b) => b.in_degree - a.in_degree);
  externals.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(externals.length, 1) - Math.PI / 2;
    n.x = cx + Math.cos(angle) * ringR;
    n.y = cy + Math.sin(angle) * ringR;
  });

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
  const [size, setSize] = useState({ w: 400, h: 600 });
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

  // Track container size so layout + fitView use real dimensions.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const apply = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-fit whenever data or container size changes.
  useEffect(() => {
    if (!data || size.w < 50 || size.h < 50) return;
    const t = setTimeout(() => fitView({ duration: 250, padding: 0.18 }), 60);
    return () => clearTimeout(t);
  }, [data, size.w, size.h, fitView]);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    const positioned = layout(data, size.w, size.h);
    const byId = new Map(positioned.map((n) => [n.id, n]));
    const nodes: Node[] = positioned.map((n) => ({
      id: n.id,
      position: { x: n.x, y: n.y },
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
        zIndex: 10,
      },
    }));
    // Prefer internal edges over external noise.
    const scored = data.edges
      .map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        const both =
          a?.kind === "internal" && b?.kind === "internal"
            ? 3
            : a?.kind === "internal" || b?.kind === "internal"
              ? 2
              : 1;
        return { e, score: both };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 80);
    const edges: Edge[] = scored.map(({ e }, i) => ({
      id: `${i}-${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      type: "smoothstep",
      style: { stroke: "var(--border)", strokeWidth: 0.6, opacity: 0.28 },
      pathOptions: { borderRadius: 4 },
    }));
    return { nodes, edges };
  }, [data, size.w, size.h]);

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