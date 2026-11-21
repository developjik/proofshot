#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { runCli } from "../src/cli";

/**
 * Resolve the real script path first: when the CLI is installed through a
 * package-manager symlink (`node_modules/.bin/proofshot`), argv[1] is the
 * link. Working from the resolved path keeps `--version` and every relative
 * lookup anchored to the installed package.
 */
function resolveEntry(): string | undefined {
  const entry = process.argv[1];
  if (!entry) return undefined;
  try {
    return realpathSync(entry);
  } catch {
    return entry;
  }
}

async function main(): Promise<void> {
  const entry = resolveEntry();
  if (entry) process.argv[1] = entry;
  const code = await runCli(process.argv.slice(2), { entry, cwd: process.cwd() });
  process.exitCode = code;
}

void main().catch((error: unknown) => {
  process.stderr.write(`proofshot: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
