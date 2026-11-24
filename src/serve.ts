import { createServer, type Server } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";

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
  // Containment is checked against the real root so a symlinked root works.
  const rootReal = await realpath(root);

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      const file = await resolveFile(rootReal, pathname);
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
      res.writeHead((error as { code?: string }).code === "ROOT_ESCAPE" ? 403 : 500, { "content-type": "text/plain; charset=utf-8" });
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

async function resolveFile(rootReal: string, pathname: string): Promise<string | null> {
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  if (relative.split(sep).includes("..")) return null;
  const target = join(rootReal, relative);

  const direct = await fileIfExistsInside(target, rootReal);
  if (direct) return direct;

  const index = await fileIfExistsInside(join(target, "index.html"), rootReal);
  if (index) return index;

  if (!/\/$/.test(pathname) && !extname(pathname)) {
    const asHtml = await fileIfExistsInside(`${target}.html`, rootReal);
    if (asHtml) return asHtml;
  }

  // SPA fallback: unknown routes render the shell.
  const shell = await fileIfExistsInside(join(rootReal, "index.html"), rootReal);
  return shell;
}

/**
 * File existence check that follows symlinks safely: the candidate's real path
 * must stay inside `rootReal`, so a link pointing outside is never served.
 */
async function fileIfExistsInside(filePath: string, rootReal: string): Promise<string | null> {
  try {
    const real = await realpath(filePath);
    if (real !== rootReal && !real.startsWith(`${rootReal}${sep}`)) {
      // Existing escape paths must not fall through to the SPA shell.
      throw Object.assign(new Error("Path escapes static root"), { code: "ROOT_ESCAPE" });
    }
    const info = await stat(real);
    return info.isFile() ? real : null;
  } catch (error) {
    if ((error as { code?: string }).code === "ROOT_ESCAPE") throw error;
    // Check the nearest existing ancestor too, so a missing file below an
    // external directory link is refused just like an existing file.
    if ((error as { code?: string }).code === "ENOENT") {
      let ancestor = dirname(filePath);
      while (ancestor !== dirname(ancestor)) {
        try {
          const real = await realpath(ancestor);
          if (real !== rootReal && !real.startsWith(`${rootReal}${sep}`)) {
            throw Object.assign(new Error("Path escapes static root"), { code: "ROOT_ESCAPE" });
          }
          break;
        } catch (parentError) {
          if ((parentError as { code?: string }).code !== "ENOENT") throw parentError;
          ancestor = dirname(ancestor);
        }
      }
    }
    return null;
  }
}
