import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

export interface StaticServer {
  /** Origin plus assigned port, e.g. `http://127.0.0.1:41234`. */
  url: string;
  root: string;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Serve a build directory on an ephemeral loopback port so both sides of a
 * comparison can be captured without the user starting anything.
 *
 * `GET /pricing` resolves `pricing/index.html`, then `pricing.html`, then
 * falls back to `index.html` for single-page apps.
 */
export async function serveDirectory(rootDir: string): Promise<StaticServer> {
  const root = resolve(rootDir);
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`proofshot: "${rootDir}" is not a directory to serve`);
  }

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      const file = await resolveFile(root, pathname);
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end(`proofshot: ${pathname} not found in ${root}`);
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`proofshot: ${(error as Error).message}`);
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    root,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}

async function resolveFile(root: string, pathname: string): Promise<string | null> {
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  if (relative.split(sep).includes("..")) return null;
  const target = join(root, relative);

  const direct = await fileIfExists(target);
  if (direct) return direct;

  if (!/\/$/.test(pathname) && !extname(pathname)) {
    const asHtml = await fileIfExists(`${target}.html`);
    if (asHtml) return asHtml;
  }

  const index = await fileIfExists(join(target, "index.html"));
  if (index) return index;

  // SPA fallback: unknown routes render the shell.
  const shell = await fileIfExists(join(root, "index.html"));
  return shell;
}

async function fileIfExists(filePath: string): Promise<string | null> {
  try {
    const info = await stat(filePath);
    return info.isFile() ? filePath : null;
  } catch {
    return null;
  }
}
