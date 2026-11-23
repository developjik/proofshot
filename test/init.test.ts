import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderWorkflowTemplate, runInit, WORKFLOW_PATH } from "../src/init";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "proofshot-init-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("proofshot init", () => {
  it("writes the workflow into .github/workflows", async () => {
    const cwd = await tempDir();
    const result = await runInit({ cwd });
    expect(result.created).toBe(true);
    expect(result.path.endsWith(WORKFLOW_PATH)).toBe(true);
    expect(existsSync(result.path)).toBe(true);

    const body = await readFile(result.path, "utf8");
    expect(body).toContain("name: proofshot");
    expect(body).toContain("on:\n  pull_request:");
    expect(body).toContain("npx playwright install --with-deps chromium");
    expect(body).toContain("npx -y @developjik/proofshot@latest compare");
    expect(body).not.toMatch(/npx (-y )?proofshot\b/);
    expect(body).toContain("gh pr comment");
    expect(body).toContain("--edit-last --create-if-none");
    expect(body).toContain("actions/upload-artifact@v4");
    expect(body).toContain("git worktree add ../proofshot-base");
  });

  it("does not overwrite an existing workflow without --force", async () => {
    const cwd = await tempDir();
    await runInit({ cwd });
    const second = await runInit({ cwd });
    expect(second.created).toBe(false);
    expect(second.reason).toContain("already exists");
  });

  it("overwrites with --force", async () => {
    const cwd = await tempDir();
    const first = await runInit({ cwd });
    await readFile(first.path, "utf8");
    const second = await runInit({ cwd, force: true });
    expect(second.created).toBe(true);
  });

  it("renders a workflow with no unresolved template expressions", () => {
    const template = renderWorkflowTemplate();
    expect(template).not.toMatch(/\$\{ROUTES\}/);
    expect(template).toContain('${ROUTES:+--routes "$ROUTES"}');
    expect(template).not.toContain("${BASE_DIR}");
  });
});
