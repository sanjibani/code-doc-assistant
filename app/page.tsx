"use client";

import { useEffect, useRef, useState } from "react";
import Chat from "./components/Chat";
import ArchitectureMap from "./components/ArchitectureMap";
import EvalRunner from "./components/EvalRunner";
import IngestForm from "./components/IngestForm";
import PipelinePanel from "./components/PipelinePanel";

type Repo = { id: string; name: string; url: string; file_count: number; chunk_count: number };

const LEFT_COLLAPSED = 280;
const LEFT_EXPANDED = 560;
const RIGHT_DEFAULT = 360;
const RIGHT_MIN = 200;
const RIGHT_MAX = 1400;
const LS_LEFT = "code-doc.leftMode";
const LS_RIGHT = "code-doc.rightWidth";
// Bump this when the demo screen layout changes so existing demo
// recordings don't show stale state. v1: chat-only.
const DEMO_SCHEMA = 1;

export default function HomePage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [leftExpanded, setLeftExpanded] = useState(false);
  const [rightWidth, setRightWidth] = useState(0); // collapsed by default for the clean demo screen
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const dragRef = useRef<{ which: "left" | "right"; startX: number; startW: number } | null>(null);

  // Load saved sizes on mount. If demo schema bumped, ignore stale state.
  useEffect(() => {
    const schema = Number(localStorage.getItem("code-doc.demoSchema") || 0);
    if (schema < DEMO_SCHEMA) {
      localStorage.setItem("code-doc.demoSchema", String(DEMO_SCHEMA));
      localStorage.removeItem(LS_LEFT);
      localStorage.removeItem(LS_RIGHT);
      setLeftExpanded(false);
      setRightWidth(0);
      return;
    }
    setLeftExpanded(localStorage.getItem(LS_LEFT) === "1");
    const rw = Number(localStorage.getItem(LS_RIGHT));
    if (Number.isFinite(rw) && rw >= 0 && rw <= RIGHT_MAX) setRightWidth(rw);
  }, []);

  // Persist + drive CSS variables.
  useEffect(() => {
    const lw = leftExpanded ? LEFT_EXPANDED : LEFT_COLLAPSED;
    document.documentElement.style.setProperty("--left-width", `${lw}px`);
    localStorage.setItem(LS_LEFT, leftExpanded ? "1" : "0");
  }, [leftExpanded]);

  useEffect(() => {
    document.documentElement.style.setProperty("--right-width", `${Math.round(rightWidth)}px`);
    localStorage.setItem(LS_RIGHT, String(Math.round(rightWidth)));
  }, [rightWidth]);

  // Global mouse listeners while dragging either handle.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      if (dragRef.current.which === "right") {
        // Drag handle is on the LEFT edge of the right panel.
        // Moving right makes panel wider, moving left makes it narrower.
        const next = Math.max(0, Math.min(RIGHT_MAX, dragRef.current.startW + dx));
        setRightWidth(next);
      }
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const onRightHandleDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { which: "right", startX: e.clientX, startW: rightWidth };
    setDragging("right");
  };

  useEffect(() => {
    fetch("/api/ingest")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.repos)) setRepos(d.repos);
        if (d.repos?.[0]) setActiveRepoId(d.repos[0].id);
      })
      .catch(() => {});
  }, []);

  const rightCollapsed = rightWidth < 50;
  const toggleRight = () => setRightWidth(rightCollapsed ? RIGHT_DEFAULT : 0);

  return (
    <div className="app" style={{ userSelect: dragging ? "none" : "auto" }}>
      <header className="header">
        <h1>Code Doc Assistant</h1>
        <span className="badge">v0.1</span>
        <div style={{ flex: 1 }} />
        <span className="muted">
          <span className="kbd">/</span> to focus search
        </span>
      </header>
      <aside className="left">
        <h3 className="section-title">Repos</h3>
        <IngestForm
          onIngested={() => {
            setIngesting(true);
            fetch("/api/ingest")
              .then((r) => r.json())
              .then((d) => {
                if (Array.isArray(d.repos)) setRepos(d.repos);
                if (d.repos?.[0]) setActiveRepoId(d.repos[0].id);
                setTimeout(() => setIngesting(false), 3000);
              });
          }}
        />
        <ul className="repo-list">
          {repos.length === 0 && <li className="muted">No repos yet. Ingest one to start.</li>}
          {repos.map((r) => (
            <li
              key={r.id}
              className={r.id === activeRepoId ? "active" : ""}
              onClick={() => setActiveRepoId(r.id)}
            >
              <div>{r.name}</div>
              <div className="repo-meta">
                {r.file_count} files / {r.chunk_count} chunks
              </div>
            </li>
          ))}
        </ul>
        <h3 className="section-title">Pipeline</h3>
        <PipelinePanel activeRepoId={activeRepoId} active={ingesting} />
        <h3 className="section-title">Eval</h3>
        <EvalRunner activeRepoId={activeRepoId} />
      </aside>
      <main className="main">
        <Chat activeRepoId={activeRepoId} />
      </main>
      <div
        className={`resize-handle right${dragging === "right" ? " dragging" : ""}${rightCollapsed ? " hidden" : ""}`}
        onMouseDown={onRightHandleDown}
        title="Drag to resize"
      >
        <span className="handle-grip">⋮</span>
      </div>
      <aside className="right" style={{ display: rightCollapsed ? "none" : undefined }}>
        <h3 className="section-title">Architecture</h3>
        <ArchitectureMap activeRepoId={activeRepoId} />
      </aside>
    </div>
  );
}