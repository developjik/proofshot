import { get } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serveDirectory } from "../src/serve";

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "proofshot-serve-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function body(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url);
  return { status: res.status, text: await res.text() };
}

describe("serveDirectory", () => {
  it("serves static files, extensionless html and the SPA fallback", async () => {
    const root = await tmp();
    await writeFile(join(root, "index.html"), "shell");
    await writeFile(join(root, "about.html"), "about-page");
    await writeFile(join(root, "style.css"), "body{}");
    const server = await serveDirectory(root);
    try {
      expect(await body(`${server.url}/style.css`)).toEqual({ status: 200, text: "body{}" });
      expect((await body(`${server.url}/about`)).text).toBe("about-page");
      expect((await body(`${server.url}/deep/spa/route`)).text).toBe("shell");
      // With an index.html present, unknown paths fall back to the shell.
      expect((await body(`${server.url}/missing.js`)).text).toBe("shell");
    } finally {
      await server.close();
    }
  });

  it("returns 404 for misses when no index.html exists", async () => {
    const root = await tmp();
    await writeFile(join(root, "only.txt"), "here");
    const server = await serveDirectory(root);
    try {
      expect((await body(`${server.url}/gone.txt`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("never serves a symlink that points outside the root", async () => {
    const root = await tmp();
    const outside = await tmp();
    await writeFile(join(root, "index.html"), "shell");
    await writeFile(join(outside, "secret.txt"), "TOP-SECRET-CONTENT");
    await mkdir(join(outside, "secrets"));
    await writeFile(join(outside, "secrets", "key.txt"), "KEY-CONTENT");
    await symlink(join(outside, "secret.txt"), join(root, "leak.txt"));
    await symlink(join(outside, "secrets"), join(root, "leaks"));
    const server = await serveDirectory(root);
    try {
      const file = await body(`${server.url}/leak.txt`);
      expect(file.text).not.toContain("TOP-SECRET-CONTENT");
      const dirHit = await body(`${server.url}/leaks/key.txt`);
      expect(dirHit.text).not.toContain("KEY-CONTENT");
      // A named .html link outside is refused even though it would exist.
      await symlink(join(outside, "secret.txt"), join(root, "leak.html"));
      const html = await body(`${server.url}/leak`);
      expect(html.text).not.toContain("TOP-SECRET-CONTENT");
      // Legitimate files keep working while hostile links are refused.
      expect((await body(`${server.url}/index.html`)).text).toBe("shell");
    } finally {
      await server.close();
    }
  });

  it("still serves links that stay inside the root", async () => {
    const root = await tmp();
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "real.txt"), "inside");
    await writeFile(join(root, "index.html"), "shell");
    await symlink(join(root, "assets", "real.txt"), join(root, "alias.txt"));
    const server = await serveDirectory(root);
    try {
      expect((await body(`${server.url}/alias.txt`)).text).toBe("inside");
    } finally {
      await server.close();
    }
  });

  it("does not expose files above the root via traversal", async () => {
    const root = await tmp();
    const outside = await tmp();
    await writeFile(join(outside, "up.txt"), "ABOVE-ROOT");
    await writeFile(join(root, "index.html"), "shell");
    const server = await serveDirectory(root);
    try {
      // Raw request-target: fetch() would normalize ".." away before sending.
      const { port } = new URL(server.url);
      const res = await new Promise<{ status: number; text: string }>((resolveReq, reject) => {
        const req = get({ host: "127.0.0.1", port, path: `/../../${outside}/up.txt` }, (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => resolveReq({ status: r.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
      });
      expect(res.text).not.toContain("ABOVE-ROOT");
    } finally {
      await server.close();
    }
  });
});
