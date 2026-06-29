"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { ReactFlowProvider, useReactFlow, type Node, type Edge } from "reactflow";
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
  const [size, setSize] = useState({ w: 320, h: 400 });
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

  // Track container size so we can re-layout + re-fit when the panel resizes.
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

  // Re-fit whenever data loads or the container size changes.
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => {
      fitView({ duration: 250, padding: 0.18 });
    }, 80);
    return () => clearTimeout(t);
  }, [data, size.w, size.h, fitView]);

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    const positioned = layout(data, size);
    const nodes: Node[] = positioned.map((n) => ({
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
        whiteSpace: "nowrap",
      },
    }));
    const edges: Edge[] = data.edges.slice(0, 200).map((e, i) => ({
      id: `${i}-${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      style: { stroke: "var(--border)", strokeWidth: 1 },
    }));
    return { nodes, edges };
  }, [data, size]);

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
        maxZoom={2}
        nodesDraggable={true}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
      >
        <Background />
        <Controls />
      </ReactFlow>
      <div className="muted" style={{ marginTop: 8 }}>
        {data.nodes.length} nodes / {data.edges.length} edges (drag to pan, scroll to zoom)
      </div>
    </div>
  );
}

// Radial layout scaled to the container. Internals on inner ring,
// externals on outer ring. fitView handles zoom-out automatically.
function layout(data: GraphData, size: { w: number; h: number }): PositionedNode[] {
  const out: PositionedNode[] = [];
  const byId = new Map<string, PositionedNode>();
  for (const n of data.nodes) {
    const node: PositionedNode = { ...n, x: 0, y: 0 };
    byId.set(n.id, node);
    out.push(node);
  }
  const internals = out.filter((n) => n.kind === "internal");
  const externals = out.filter((n) => n.kind === "external");
  const cx = size.w / 2;
  const cy = size.h / 2;
  const rIn = Math.max(60, Math.min(size.w, size.h) * 0.18);
  const rOut = Math.max(rIn + 60, Math.min(size.w, size.h) * 0.4);
  internals.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(internals.length, 1);
    n.x = cx + Math.cos(angle) * rIn;
    n.y = cy + Math.sin(angle) * rIn;
  });
  externals.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(externals.length, 1);
    n.x = cx + Math.cos(angle) * rOut;
    n.y = cy + Math.sin(angle) * rOut;
  });
  return out;
}