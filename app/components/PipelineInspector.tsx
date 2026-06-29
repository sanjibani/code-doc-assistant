"use client";

// Pipeline Inspector. Shows the live ingest trace so the user can
// see exactly what the system is doing: walking files, AST chunking
// per file with the symbols it found, embedding batches, and final
// stats. Collapsed by default; expands to show the full log.

interface TraceEvent {
  ts: string;
  stage: "walking" | "chunking" | "embedding" | "done";
  msg: string;
  detail?: Record<string, unknown>;
}

interface Props {
  trace: TraceEvent[];
  active: boolean;
}

const STAGE_LABEL: Record<string, string> = {
  walking: "walk",
  chunking: "chunk",
  embedding: "embed",
  done: "done",
};

const STAGE_COLOR: Record<string, string> = {
  walking: "var(--accent)",
  chunking: "var(--warn)",
  embedding: "var(--good)",
  done: "var(--accent)",
};

export default function PipelineInspector({ trace, active }: Props) {
  if (!trace || trace.length === 0) return null;

  // Show last 30 events by default, all if expanded.
  const last = trace[trace.length - 1];
  const progress = (() => {
    if (last?.stage === "walking") return { pct: 5, label: "walking filesystem" };
    if (last?.stage === "chunking") return { pct: 30, label: "AST chunking" };
    if (last?.stage === "embedding") {
      const m = String(last.msg).match(/batch (\d+)\/(\d+)/);
      if (m) return { pct: 30 + Math.round((Number(m[1]) / Number(m[2])) * 60), label: `embedding batch ${m[1]}/${m[2]}` };
      return { pct: 50, label: "embedding" };
    }
    if (last?.stage === "done") return { pct: 100, label: "complete" };
    return { pct: 0, label: "starting" };
  })();

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--fg-muted)", marginBottom: 4 }}>
        <span style={{
          display: "inline-block", width: 6, height: 6, borderRadius: "50%",
          background: active ? "var(--good)" : "var(--fg-muted)",
          animation: active ? "pulse 1.2s ease-in-out infinite" : "none",
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
          show pipeline trace ({trace.length} events)
        </summary>
        <div style={{
          marginTop: 6, padding: 8, background: "var(--bg)",
          border: "1px solid var(--border)", borderRadius: 4,
          fontFamily: "var(--mono)", fontSize: 10.5, lineHeight: 1.5,
          maxHeight: 220, overflowY: "auto",
        }}>
          {trace.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <span style={{ color: "var(--fg-muted)", flexShrink: 0 }}>{e.ts}</span>
              <span style={{ color: STAGE_COLOR[e.stage] ?? "var(--fg)", flexShrink: 0, width: 56 }}>
                [{STAGE_LABEL[e.stage]}]
              </span>
              <span style={{ flex: 1, wordBreak: "break-word" }}>{e.msg}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}