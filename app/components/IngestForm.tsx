"use client";

import { useState } from "react";

interface Props {
  onIngested: (result: { repo_id: string }) => void;
}

export default function IngestForm({ onIngested }: Props) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ local_path: path, name: name || undefined }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error ?? "ingest failed");
      onIngested({ repo_id: data.repo_id });
      setPath("");
      setName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ingest-form" onSubmit={submit}>
      <label>Repo path</label>
      <input
        placeholder="/Users/me/code/some-repo"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        disabled={busy}
        required
      />
      <label>Name (optional)</label>
      <input
        placeholder="some-repo"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
      />
      <button type="submit" disabled={busy || !path}>
        {busy ? "Ingesting..." : "Ingest"}
      </button>
      {err && <div className="muted" style={{ color: "var(--bad)" }}>{err}</div>}
    </form>
  );
}