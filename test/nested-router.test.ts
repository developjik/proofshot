import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { test, expect } from "vitest";
import { parseRouterSource, inferRoutes } from "../src/routes";
import { runCompare } from "../src/compare";
import { serveDirectory } from "../src/serve";
import { chromium } from "playwright";

test("captures the inferred nested React Router child instead of the SPA fallback", async () => {
  const fixture = resolve("test/fixtures/nested-router");
  // Isolated, pinned fixture dependencies are not part of the published package.
  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: fixture, stdio: "pipe" },
  );
  const temp = await mkdtemp(join(tmpdir(), "proofshot-nested-"));
  let server: Awaited<ReturnType<typeof serveDirectory>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const before = join(temp, "before"),
      after = join(temp, "after");
    await mkdir(before);
    await mkdir(after);
    const source = await readFile(join(fixture, "app.tsx"), "utf8");
    const inferred = inferRoutes(["src/pages/Settings.tsx"], {
      routerRoutes: parseRouterSource(source, "src/App.tsx"),
    });
    expect(inferred.map((x) => x.route)).toEqual(["/dashboard/settings"]);
    for (const [dir, heading] of [
      [before, "Nested Settings"],
      [after, "Updated Nested Settings"],
    ]) {
      await build({
        stdin: {
          contents: source.replace("Nested Settings", heading),
          resolveDir: fixture,
          loader: "tsx",
        },
        bundle: true,
        outfile: join(dir, "app.js"),
      });
      await writeFile(
        join(dir, "index.html"),
        `<!doctype html><html lang="en"><meta charset="utf-8"><title>Nested router fixture</title><style>body{font:18px system-ui;margin:40px;background:#f5f7fb;color:#182238}header{padding:18px;background:#17315a;color:white}section{background:white;padding:28px;margin-top:20px}label{display:block;margin:18px 0}input,button{font:inherit;padding:9px}</style><div id="root"></div><script src="/app.js"></script></html>`,
      );
    }
    server = await serveDirectory(after);
    browser = await chromium.launch({
      executablePath: process.env.PROOFSHOT_CHROMIUM_PATH || undefined,
      headless: true,
    });
    const page = await browser.newPage();
    await page.goto(server.url + inferred[0]!.route);
    await page
      .getByRole("heading", { name: "Updated Nested Settings" })
      .waitFor();
    expect(await page.locator("#proof").innerText()).toContain(
      "/dashboard/settings",
    );
    await page.goto(server.url + "/settings");
    await page.getByRole("heading", { name: "Wrong capture target" }).waitFor();
    const project = join(temp, "project");
    await mkdir(join(project, "src/pages"), { recursive: true });
    await writeFile(join(project, "src/App.tsx"), source);
    await writeFile(
      join(project, "src/pages/Settings.tsx"),
      "export const Settings=()=>null;",
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: project, stdio: "pipe" });
    git("init");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--no-gpg-sign",
      "-m",
      "base",
    );
    await writeFile(
      join(project, "src/pages/Settings.tsx"),
      'export const Settings=()=>"changed";',
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--no-gpg-sign",
      "-m",
      "change settings",
    );
    const outcome = await runCompare({
      cwd: project,
      baseRef: "HEAD~1",
      headRef: "HEAD",
      base: before,
      head: after,
      outDir: join(temp, "report"),
      viewports: [{ name: "desktop", width: 1280, height: 800 }],
      settleMs: 50,
    });
    expect(outcome.stats.errors).toBe(0);
    expect(outcome.results[0]?.route).toBe("/dashboard/settings");
    expect(outcome.results[0]?.status).toBe("changed");
    if (process.env.PROOFSHOT_NESTED_EVIDENCE) {
      const { copyFile } = await import("node:fs/promises");
      await copyFile(
        join(temp, "report", outcome.results[0]!.images.after!),
        process.env.PROOFSHOT_NESTED_EVIDENCE,
      );
    }
  } finally {
    await browser?.close();
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  }
}, 60000);
