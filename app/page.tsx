"use client";

import { useEffect, useState } from "react";
import Chat from "./components/Chat";
import ArchitectureMap from "./components/ArchitectureMap";
import EvalRunner from "./components/EvalRunner";
import IngestForm from "./components/IngestForm";
import PipelinePanel from "./components/PipelinePanel";

type Repo = { id: string; name: string; url: string; file_count: number; chunk_count: number };

const LEFT_COLLAPSED = 280;
const LEFT_EXPANDED = 560;
const LS_KEY = "code-doc.leftMode";

export default function HomePage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Load saved expand state on mount.
  useEffect(() => {
    setExpanded(localStorage.getItem(LS_KEY) === "1");
  }, []);

  // Persist + drive CSS variable. Two fixed widths, no drag math.
  useEffect(() => {
    const w = expanded ? LEFT_EXPANDED : LEFT_COLLAPSED;
    document.documentElement.style.setProperty("--left-width", `${w}px`);
    localStorage.setItem(LS_KEY, expanded ? "1" : "0");
  }, [expanded]);

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
    <div className="app">
      <header className="header">
        <h1>Code Doc Assistant</h1>
        <span className="badge">v0.1</span>
        <div style={{ flex: 1 }} />
        <button
          className="toggle-panel"
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {expanded ? "« Collapse" : "» Expand"}
        </button>
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
      <aside className="right">
        <h3 className="section-title">Architecture</h3>
        <ArchitectureMap activeRepoId={activeRepoId} />
      </aside>
    </div>
  );
}