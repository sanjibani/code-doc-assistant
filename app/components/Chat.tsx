"use client";

import { useEffect, useRef, useState } from "react";
import RetrievalPanel from "./RetrievalPanel";

interface Source {
  chunk_id: string;
  path: string;
  start_line: number;
  end_line: number;
  symbol: string | null;
  kind: string;
  rrf_score: number;
  bm25_rank: number | null;
  vector_rank: number | null;
  local_path?: string;
  branch?: string;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  sources: Source[];
  latency_ms?: number;
}

const EXAMPLES = [
  "How is routing implemented?",
  "Where is the dev server entry point?",
  "Show me how middleware composes for a request.",
  "Where is the build manifest generator?",
];

export default function Chat({ activeRepoId }: { activeRepoId: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(q: string) {
    if (!q.trim() || !activeRepoId || busy) return;
    setBusy(true);
    setLastLatency(null);
    const userMsg: Message = { role: "user", text: q, sources: [] };
    const assistantMsg: Message = { role: "assistant", text: "", sources: [] };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setInput("");
    const t0 = Date.now();
    try {
      const r = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, repo_id: activeRepoId }),
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      let sources: Source[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        // Parse SSE frames.
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          let data: any;
          try { data = JSON.parse(payload); } catch { continue; }
          if (frame.startsWith("event: chunk")) {
            assistantMsg.text += data.delta;
            setMessages((m) => {
              const next = m.slice();
              next[next.length - 1] = { ...assistantMsg };
              return next;
            });
          } else if (frame.startsWith("event: done")) {
            sources = data.sources ?? [];
            setMessages((m) => {
              const next = m.slice();
              next[next.length - 1] = { ...assistantMsg, sources, latency_ms: data.latency_ms };
              return next;
            });
            setLastLatency(Date.now() - t0);
          } else if (frame.startsWith("event: error")) {
            throw new Error(data.error ?? "stream error");
          }
        }
      }
    } catch (e) {
      setMessages((m) => {
        const next = m.slice();
        next[next.length - 1] = {
          ...assistantMsg,
          text: assistantMsg.text + `\n\n[error: ${e instanceof Error ? e.message : String(e)}]`,
        };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="chat" ref={scrollerRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <h2>Ask about the indexed code.</h2>
            <p>
              Every answer cites the file and line range it came from. Click a citation to jump to the
              source.
            </p>
            {EXAMPLES.map((q) => (
              <div key={q} className="example" onClick={() => send(q)}>
                {q}
              </div>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <div className="role">{m.role}</div>
            <AssistantText text={m.text} />
            {m.role === "assistant" && m.text && (
              <RetrievalPanel question={m.text.startsWith("error") ? "" : (messages[i - 1]?.text ?? "")} loading={m.text === ""} />
            )}
            {m.sources.length > 0 ? <Sources sources={m.sources} /> : null}
            {m.latency_ms != null && (
              <div className="muted" style={{ marginTop: 8, fontSize: 11 }}>
                {m.latency_ms}ms · {m.sources.length} sources
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="composer">
        <div className="composer-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              activeRepoId ? "Ask a question about the code..." : "Ingest a repo to start asking questions."
            }
            disabled={!activeRepoId || busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button onClick={() => send(input)} disabled={!activeRepoId || busy || !input.trim()}>
            Ask
          </button>
        </div>
      </div>
      {lastLatency != null && (
        <div className="latency">last answer: {lastLatency}ms end-to-end</div>
      )}
    </>
  );
}

// Render assistant text with [src: path#Lstart-Lend] tags turned into
// citation chips. Anything else renders as plain text with newlines
// preserved via <pre>-style wrap on fenced code.
function AssistantText({ text }: { text: string }) {
  if (!text) return <div className="muted">thinking...</div>;
  // Split out fenced code blocks first so we don't munge citations inside them.
  const parts: Array<{ kind: "text" | "code"; content: string; lang?: string }> = [];
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let m;
  while ((m = fenceRe.exec(text))) {
    if (m.index > lastIdx) parts.push({ kind: "text", content: text.slice(lastIdx, m.index) });
    parts.push({ kind: "code", content: m[2] ?? "", lang: m[1] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push({ kind: "text", content: text.slice(lastIdx) });

  return (
    <div>
      {parts.map((p, i) =>
        p.kind === "code" ? (
          <pre key={i}>{p.content}</pre>
        ) : (
          <p key={i} style={{ margin: "0 0 8px 0", whiteSpace: "pre-wrap" }}>
            <TextWithCitations text={p.content} />
          </p>
        ),
      )}
    </div>
  );
}

function TextWithCitations({ text }: { text: string }) {
  // Citation form: [src: <path>#L<start>-L<end>]
  // <path> may contain spaces. We match anything that's not `]` to
  // be permissive, then validate the structure on capture.
  const re = /\[src:\s*([^\]]+)\]/g;
  const out: Array<string | { path: string; line: string }> = [];
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index));
    const inside = m[1] ?? "";
    // Split on the LAST `#` so paths with `#` in them still work.
    const hashIdx = inside.lastIndexOf("#");
    const path = hashIdx >= 0 ? inside.slice(0, hashIdx) : inside;
    const line = hashIdx >= 0 ? inside.slice(hashIdx + 1) : "";
    out.push({ path, line });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return (
    <>
      {out.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <a
            key={i}
            className="citation"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              const target = `file://${p.path}#${p.line}`;
              window.open(target, "_blank");
            }}
            title={`${p.path} ${p.line}`}
          >
            {p.path.split("/").pop() ?? p.path} {p.line}
          </a>
        ),
      )}
    </>
  );
}

function Sources({ sources }: { sources: Source[] }) {
  return (
    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
      {sources.map((s) => (
        <a
          key={s.chunk_id}
          className="citation"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            const target = `file://${s.path}#L${s.start_line}-L${s.end_line}`;
            window.open(target, "_blank");
          }}
          title={`${s.path} L${s.start_line}-L${s.end_line} · rrf=${s.rrf_score.toFixed(3)} · bm25=${s.bm25_rank ?? "-"} vec=${s.vector_rank ?? "-"}`}
        >
          {s.path.split("/").pop() ?? s.path}:L{s.start_line}
          {s.symbol && <span style={{ color: "var(--fg-muted)" }}> {s.symbol}</span>}
        </a>
      ))}
    </div>
  );
}