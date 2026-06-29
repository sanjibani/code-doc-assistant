"use client";

import { useEffect, useRef, useState } from "react";
import Chat from "./components/Chat";
import ArchitectureMap from "./components/ArchitectureMap";
import EvalRunner from "./components/EvalRunner";
import IngestForm from "./components/IngestForm";
import PipelinePanel from "./components/PipelinePanel";

type Repo = { id: string; name: string; url: string; file_count: number; chunk_count: number };

const LEFT_MIN = 220;
const LEFT_MAX = 800;
const LEFT_DEFAULT = 280;
const LS_KEY = "code-doc.leftWidth";

export default function HomePage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // Load saved left width on mount.
  useEffect(() => {
    const saved = Number(localStorage.getItem(LS_KEY));
    if (Number.isFinite(saved) && saved >= LEFT_MIN && saved <= LEFT_MAX) {
      setLeftWidth(saved);
    }
  }, []);

  // Persist width + drive CSS variable.
  useEffect(() => {
    document.documentElement.style.setProperty("--left-width", `${leftWidth}px`);
    localStorage.setItem(LS_KEY, String(leftWidth));
  }, [leftWidth]);

  // Global mouse listeners while dragging.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const next = Math.max(LEFT_MIN, Math.min(LEFT_MAX, dragRef.current.startW + dx));
      setLeftWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const onHandleDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: leftWidth };
    setDragging(true);
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
      <div
        className={`resize-handle${dragging ? " dragging" : ""}`}
        onMouseDown={onHandleDown}
        title="Drag to resize"
      />
      <main className="main">
        <Chat activeRepoId={activeRepoId} />
      </main>
      <aside className="right">
        <h3 className="section-title">Architecture</h3>
        <ArchitectureMap activeRepoId={activeRepoId} />
      </aside>
    </div>
  );
}