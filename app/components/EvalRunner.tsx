"use client";

import { useState } from "react";

interface EvalResultRow {
  question: string;
  expected_paths: string[];
  retrieved_paths: string[];
  cited: boolean;
  recall_at_5: number;
}

interface EvalSummary {
  run_id: string;
  total: number;
  passed: number;
  recall_at_5: number;
  cite_rate: number;
  results: EvalResultRow[];
  duration_ms: number;
}

export default function EvalRunner({ activeRepoId }: { activeRepoId: string | null }) {
  const [result, setResult] = useState<EvalSummary | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!activeRepoId || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_id: activeRepoId }),
      });
      const data = await r.json();
      if (data.ok) setResult(data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={run} disabled={!activeRepoId || busy} style={{ width: "100%" }}>
        {busy ? "Running..." : "Run eval (25 Q&A)"}
      </button>
      {result && (
        <div style={{ marginTop: 12 }}>
          <div className="muted" style={{ marginBottom: 8 }}>
            <span style={{ color: "var(--fg)" }}>{result.passed}/{result.total}</span> passed
            · recall@5 <span style={{ color: "var(--fg)" }}>{(result.recall_at_5 * 100).toFixed(0)}%</span>
            · cite rate <span style={{ color: "var(--fg)" }}>{(result.cite_rate * 100).toFixed(0)}%</span>
            · {result.duration_ms}ms
          </div>
          {result.results.slice(0, 5).map((r, i) => {
            const pass = r.recall_at_5 === 1 && r.cited;
            return (
              <div key={i} className={`eval-result ${pass ? "pass" : "fail"}`}>
                <div style={{ marginBottom: 4 }}>{r.question}</div>
                <div className="muted" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>
                  recall@5: {(r.recall_at_5 * 100).toFixed(0)}% · cited: {r.cited ? "yes" : "no"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}