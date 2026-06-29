// In-memory ring buffer of ingest progress events. One buffer per
// repo, keyed by repo_id. The /api/ingest/trace route reads from
// here. Cap at 500 events per repo to bound memory.
//
// This is a process-local store. If you run multiple Node processes
// behind a load balancer, switch to Redis pub/sub or a SQLite
// append-only table. For the demo (single process) this is enough.

export type IngestStage = "walking" | "chunking" | "embedding" | "done" | "error";

export interface IngestEvent {
  ts: string;
  stage: IngestStage;
  msg: string;
  detail?: Record<string, unknown>;
}

const BUFFERS = new Map<string, IngestEvent[]>();
const MAX_PER_REPO = 500;

export function pushEvent(repoId: string, ev: IngestEvent): void {
  let buf = BUFFERS.get(repoId);
  if (!buf) {
    buf = [];
    BUFFERS.set(repoId, buf);
  }
  buf.push(ev);
  if (buf.length > MAX_PER_REPO) buf.shift();
}

export function getEvents(repoId: string): IngestEvent[] {
  return BUFFERS.get(repoId) ?? [];
}

export function clearEvents(repoId: string): void {
  BUFFERS.delete(repoId);
}