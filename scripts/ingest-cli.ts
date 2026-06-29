#!/usr/bin/env tsx
// CLI: ingest a local repo into the index.
//
// Usage:
//   pnpm ingest <path-to-repo> [repo-url] [name]
//
// If repo-url is omitted we use file:// + absolute path.
// If name is omitted we use the basename of the path.
//
// Prints a progress line per stage (walking / chunking / embedding / done).

import { resolve, basename } from "node:path";
import { ingestRepo } from "../lib/ingest.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: pnpm ingest <path-to-repo> [repo-url] [name]");
    process.exit(1);
  }
  const localPath = resolve(args[0]!);
  const repoUrl = args[1] ?? `file://${localPath}`;
  const name = args[2] ?? basename(localPath);

  console.error(`ingesting ${localPath} as ${name} (${repoUrl})`);
  const result = await ingestRepo({
    repoUrl,
    repoName: name,
    localPath,
    traceId: `ingest-${Date.now()}`,
    onProgress: (stage, done, total) => {
      process.stderr.write(`  [${stage}] ${done}/${total}\n`);
    },
  });
  console.error(
    `done. files=${result.file_count} chunks=${result.chunk_count} edges=${result.edge_count} elapsed=${(result.duration_ms / 1000).toFixed(1)}s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});