#!/usr/bin/env tsx
// CLI wrapper for the eval harness.
//
// Usage:
//   pnpm eval                 (uses default fixtures, all repos)
//   pnpm eval <repo_id>       (default fixtures, specific repo)
//   pnpm eval <repo_id> <fixtures_file>   (custom fixtures)

import { runEval } from "../lib/eval";

async function main(): Promise<void> {
  const repoId = process.argv[2];
  const fixturesFile = process.argv[3];
  const result = await runEval({ repoId, fixturesFile });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed === result.total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});