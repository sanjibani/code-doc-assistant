"use client";

// Retrieval Inspector. Shows the top-K chunks that hybrid search
// returned for a question, with both legs of the search visible.
// Three columns: BM25 results, vector results, fused top-K that
// went to the LLM. Lets the user see exactly what the system
// "thought" was relevant.

interface RetrievalTrace {
  question: string;
  bm25: Array<{ rank: number; path: string; lines: string; symbol: string; score: number }>;
  vector: Array<{ rank: number; path: string; lines: string; symbol: string; sim: number }>;
  fused: Array<{
    rank: number; path: string; lines: string; symbol: string;
    rrf: number; bm25_rank: number | null; vec_rank: number | null;
    in_both: boolean; picked: boolean;
  }>;
  explanation: {
    bm25_winner: string;
    vector_winner: string;
    rrf_promoted: string;
    dropped_for_llm: string;
  };
}

interface Props {
  trace: RetrievalTrace | null;
  loading: boolean;
}

export default function RetrievalInspector({ trace, loading }: Props) {
  if (loading) {
    return (
      <div style={{ marginTop: 8, padding: 8, fontSize: 11, color: "var(--fg-muted)" }}>
        running hybrid search...
      </div>
    );
  }
  if (!trace) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: "var(--fg-muted)", marginBottom: 4 }}>
        Q: <span style={{ color: "var(--fg)" }}>{trace.question}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
        <Col title="BM25 (keyword)" entries={trace.bm25.map(b => ({
          key: `${b.path}:${b.lines}`,
          rank: b.rank,
          symbol: b.symbol,
          score: b.score.toFixed(2),
          color: "var(--warn)",
        }))} />
        <Col title="Vector (semantic)" entries={trace.vector.map(v => ({
          key: `${v.path}:${v.lines}`,
          rank: v.rank,
          symbol: v.symbol,
          score: v.sim.toFixed(2),
          color: "var(--good)",
        }))} />
        <Col title="Fused (RRF, top-K to LLM)" entries={trace.fused.map(f => ({
          key: `${f.path}:${f.lines}`,
          rank: f.rank,
          symbol: f.symbol,
          score: f.rrf.toFixed(4),
          color: f.in_both ? "var(--accent)" : "var(--fg-muted)",
          badges: [
            ...(f.bm25_rank != null ? [`bm25:${f.bm25_rank}`] : []),
            ...(f.vec_rank != null ? [`vec:${f.vec_rank}`] : []),
          ],
        }))} />
      </div>
      <div style={{
        padding: 8, background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: 4, fontSize: 11, lineHeight: 1.6, color: "var(--fg-muted)",
      }}>
        <div><span style={{ color: "var(--warn)" }}>bm25:</span> {trace.explanation.bm25_winner}</div>
        <div><span style={{ color: "var(--good)" }}>vec:</span> {trace.explanation.vector_winner}</div>
        <div><span style={{ color: "var(--accent)" }}>rrf:</span> {trace.explanation.rrf_promoted}</div>
        <div><span style={{ color: "var(--fg-muted)" }}>drop:</span> {trace.explanation.dropped_for_llm}</div>
      </div>
    </div>
  );
}

function Col({ title, entries }: { title: string; entries: Array<{ key: string; rank: number; symbol: string; score: string; color: string; badges?: string[] }> }) {
  return (
    <div style={{
      background: "var(--bg)", border: "1px solid var(--border)",
      borderRadius: 4, padding: 6,
    }}>
      <div style={{ fontSize: 10, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
        {title}
      </div>
      {entries.slice(0, 6).map((e) => (
        <div key={e.key} style={{ fontSize: 10, fontFamily: "var(--mono)", lineHeight: 1.5, color: "var(--fg)" }}>
          <span style={{ color: e.color, marginRight: 4 }}>#{e.rank}</span>
          <span style={{ color: "var(--fg)" }}>{e.symbol || "(no name)"}</span>
          <span style={{ color: "var(--fg-muted)", marginLeft: 4 }}>{e.score}</span>
          {e.badges && e.badges.length > 0 && (
            <span style={{ marginLeft: 4, color: "var(--fg-muted)" }}>{e.badges.join(" ")}</span>
          )}
        </div>
      ))}
    </div>
  );
}