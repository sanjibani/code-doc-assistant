// Shared chunk shape. The DB row maps directly to this. We keep it
// here so the chunker doesn't pull in any DB code (chunker must be
// pure and testable in isolation).

export interface Chunk {
  path: string;
  start_line: number;
  end_line: number;
  kind: string;
  symbol: string | null;
  text: string;
  token_est: number;
}