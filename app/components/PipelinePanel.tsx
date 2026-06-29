"use client";

import { useEffect, useState } from "react";

interface TraceEvent {
  ts: string;
  stage: "walking" | "chunking" | "embedding" | "done";
  msg: string;
  detail?: Record<string, unknown>;
}

interface Props {
  activeRepoId: string | null;
  active: boolean;
}

// Pipeline inspector panel in the left sidebar. Polls the trace
// endpoint so the user can see live ingest progress (or replay the
// last run from the demo seed).

export default function PipelinePanel({ activeRepoId, active }: Props) {
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeRepoId) {
      setTrace([]);
      return;
    }
    const fetchTrace = async () => {
      try {
        const r = await fetch(`/api/ingest/trace?repo_id=${encodeURIComponent(activeRepoId)}`);
        const data = await r.json();
        if (Array.isArray(data.trace)) setTrace(data.trace);
      } catch {
        // ignore
      }
    };
    fetchTrace();
    if (active) {
      const id = setInterval(fetchTrace, 1500);
      return () => clearInterval(id);
    }
  }, [activeRepoId, active]);

  if (!trace || trace.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 11, color: "var(--fg-muted)", textTransform: "uppercase",
        letterSpacing: "0.06em", marginBottom: 6,
      }}>
        Pipeline trace
      </div>
      <LiveTrace trace={trace} active={active} />
    </div>
  );
}

function LiveTrace({ trace, active }: { trace: TraceEvent[]; active: boolean }) {
  const last = trace[trace.length - 1];
  if (!last) return null;

  const progress = (() => {
    if (last.stage === "walking") return { pct: 5, label: "walking filesystem" };
    if (last.stage === "chunking") return { pct: 30, label: "AST chunking" };
    if (last.stage === "embedding") {
      const m = String(last.msg).match(/batch (\d+)\/(\d+)/);
      if (m) return { pct: 30 + Math.round((Number(m[1]) / Number(m[2])) * 60), label: `embedding ${m[1]}/${m[2]}` };
      return { pct: 50, label: "embedding" };
    }
    if (last.stage === "done") return { pct: 100, label: "complete" };
    return { pct: 0, label: "starting" };
  })();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--fg-muted)", marginBottom: 4 }}>
        <span style={{
          display: "inline-block", width: 6, height: 6, borderRadius: "50%",
          background: active ? "var(--good)" : "var(--fg-muted)",
        }} />
        <span>{active ? "live:" : "last:"} {progress.label}</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono)" }}>{progress.pct}%</span>
      </div>
      <div style={{ height: 4, background: "var(--bg)", borderRadius: 2, overflow: "hidden", marginBottom: 8 }}>
        <div style={{
          width: `${progress.pct}%`, height: "100%",
          background: progress.pct === 100 ? "var(--good)" : "var(--accent)",
          transition: "width 200ms",
        }} />
      </div>
      <details>
        <summary style={{ fontSize: 11, color: "var(--fg-muted)", cursor: "pointer", userSelect: "none" }}>
          show full trace ({trace.length} events)
        </summary>
        <div style={{
          marginTop: 6, padding: 8, background: "var(--bg)",
          border: "1px solid var(--border)", borderRadius: 4,
          fontFamily: "var(--mono)", fontSize: 10.5, lineHeight: 1.5,
          maxHeight: 240, overflowY: "auto",
        }}>
          {trace.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <span style={{ color: "var(--fg-muted)", flexShrink: 0 }}>{e.ts}</span>
              <span style={{ color: stageColor(e.stage), flexShrink: 0, width: 50 }}>
                [{stageLabel(e.stage)}]
              </span>
              <span style={{ flex: 1, wordBreak: "break-word" }}>{e.msg}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function stageColor(s: string): string {
  if (s === "chunking") return "var(--warn)";
  if (s === "embedding") return "var(--good)";
  return "var(--accent)";
}

function stageLabel(s: string): string {
  return { walking: "walk", chunking: "chunk", embedding: "embed", done: "done" }[s] ?? s;
}