"use client";

import { useEffect, useState } from "react";

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
  question: string;
  loading: boolean;
}

// Three-column trace of what hybrid search returned for a question.
// Loaded per-question. Shows the raw BM25 hits, the raw vector
// hits, and the fused top-K with the per-chunk metadata.

export default function RetrievalPanel({ question, loading }: Props) {
  const [trace, setTrace] = useState<RetrievalTrace | null>(null);

  useEffect(() => {
    if (!question) {
      setTrace(null);
      return;
    }
    setTrace(null);
    let cancelled = false;
    fetch(`/api/retrieve?q=${encodeURIComponent(question)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setTrace(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [question]);

  if (!question) return null;
  if (loading || !trace) {
    return (
      <div style={{ marginTop: 10, padding: 8, fontSize: 11, color: "var(--fg-muted)" }}>
        running hybrid search (BM25 + sqlite-vec + RRF)...
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        fontSize: 10, color: "var(--fg-muted)", textTransform: "uppercase",
        letterSpacing: "0.06em", marginBottom: 4,
      }}>
        Retrieval trace: what the system found before sending to LLM
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
        <Col
          title="BM25 (keyword)"
          entries={trace.bm25.slice(0, 6).map((b) => ({
            key: `${b.path}:${b.lines}`,
            rank: b.rank,
            symbol: b.symbol,
            score: b.score.toFixed(2),
            color: "var(--warn)",
          }))}
        />
        <Col
          title="Vector (semantic)"
          entries={trace.vector.slice(0, 6).map((v) => ({
            key: `${v.path}:${v.lines}`,
            rank: v.rank,
            symbol: v.symbol,
            score: v.sim.toFixed(2),
            color: "var(--good)",
          }))}
        />
        <Col
          title="Fused (RRF, top-K to LLM)"
          entries={trace.fused.slice(0, 6).map((f) => ({
            key: `${f.path}:${f.lines}`,
            rank: f.rank,
            symbol: f.symbol,
            score: f.rrf.toFixed(4),
            color: f.in_both ? "var(--accent)" : "var(--fg-muted)",
            badges: [
              ...(f.bm25_rank != null ? [`bm25:${f.bm25_rank}`] : []),
              ...(f.vec_rank != null ? [`vec:${f.vec_rank}`] : []),
            ],
          }))}
        />
      </div>
      <div style={{
        padding: 8, background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: 4, fontSize: 11, lineHeight: 1.6, color: "var(--fg-muted)",
      }}>
        <div><span style={{ color: "var(--warn)" }}>bm25 winner:</span> {trace.explanation.bm25_winner}</div>
        <div><span style={{ color: "var(--good)" }}>vec winner:</span> {trace.explanation.vector_winner}</div>
        <div><span style={{ color: "var(--accent)" }}>rrf promoted:</span> {trace.explanation.rrf_promoted}</div>
        <div><span style={{ color: "var(--fg-muted)" }}>dropped:</span> {trace.explanation.dropped_for_llm}</div>
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
      {entries.map((e) => (
        <div key={e.key} style={{ fontSize: 10, fontFamily: "var(--mono)", lineHeight: 1.5 }}>
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