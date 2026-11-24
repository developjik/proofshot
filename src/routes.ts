import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ProofshotConfig,
  RouteCandidate,
  RouteFramework,
  RouterRoute,
} from "./types";
import {
  basename,
  componentKey,
  isDocumentation,
  isIgnoredSource,
  isStyleSheet,
  kebabCase,
  normalizeRoute,
  toPosix,
} from "./util";

export interface InferRoutesOptions {
  config?: ProofshotConfig;
  /** Routes discovered from React Router definition files. */
  routerRoutes?: RouterRoute[];
  /** Where to send everyone when nothing route-like changed. Default `/`. */
  fallbackRoute?: string;
  /**
   * Treat `src/pages/*` as Next.js Pages Router. When omitted, `src/pages` is
   * read as a Vite/SPA pages folder unless a router match says otherwise.
   */
  nextProject?: boolean;
}

const NEXT_APP_PAGE = /^page\.(tsx|ts|jsx|js|mdx)$/;
const NEXT_PAGES_FILE = /^(?:src\/)?pages\/(.+)\.(tsx|ts|jsx|js|mdx)$/;
const NEXT_PAGES_SKIP = /^(_app|_document|_error|404|500)$/;
const SOURCE_EXT = /\.(tsx|ts|jsx|js|mdx)$/;

/**
 * Turn a list of changed files into the routes worth screenshotting.
 *
 * Works with no configuration for Next.js (App and Pages Router), React Router
 * projects (using routes parsed out of the router files) and plain Vite/SPA
 * layouts. `.proofshot.json` `routes` replaces the inference entirely.
 */
export function inferRoutes(
  changedFiles: string[],
  options: InferRoutesOptions = {},
): RouteCandidate[] {
  const config = options.config ?? {};
  if (Array.isArray(config.routes) && config.routes.length > 0) {
    return config.routes.map((route) => ({
      route: normalizeRoute(route),
      framework: "config" as RouteFramework,
      source: ".proofshot.json",
      reason: "listed in .proofshot.json",
      dynamic: false,
    }));
  }

  const routerRoutes = options.routerRoutes ?? [];
  const routerFileSet = new Set(
    routerRoutes.map((route) => toPosix(route.file)),
  );
  const out: RouteCandidate[] = [];
  const seen = new Set<string>();

  const push = (
    route: string,
    framework: RouteFramework,
    source: string,
    reason: string,
    dynamic?: boolean,
  ): void => {
    const normalized = normalizeRoute(route);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push({
      route: normalized,
      framework,
      source: toPosix(source),
      reason,
      dynamic: dynamic ?? /\[[^\]]+\]|:[A-Za-z_][A-Za-z0-9_]*/.test(normalized),
    });
  };

  for (const rawFile of changedFiles) {
    const file = toPosix(rawFile).replace(/^\.\//, "");
    if (isIgnoredSource(file)) continue;

    const nextApp = nextAppRoute(file);
    if (nextApp) {
      push(nextApp.route, "next-app", file, nextApp.reason);
      continue;
    }

    // React Router first for files under src/: `src/pages/Pricing.tsx` is a
    // React Router page in a React Router project and a Next page otherwise.
    const routerMatch = matchRouterRoute(file, routerRoutes, routerFileSet);
    if (routerMatch.length > 0) {
      for (const route of routerMatch) {
        push(
          route.route,
          "react-router",
          file,
          route.component
            ? `route element <${route.component}> is defined in ${route.file}`
            : `declared in ${route.file}`,
        );
      }
      continue;
    }

    const nextPages = nextPagesRoute(file, {
      allowSrcPages: options.nextProject === true,
    });
    if (nextPages) {
      push(nextPages.route, "next-pages", file, nextPages.reason);
      continue;
    }

    const staticRoute = staticHtmlRoute(file);
    if (staticRoute) {
      push(staticRoute, "static", file, `static HTML page ${file}`);
      continue;
    }

    if (isDocumentation(file)) continue;

    if (isStyleSheet(file)) {
      push(
        "/",
        "config",
        file,
        "stylesheet changed — capturing the home page (list routes in .proofshot.json to widen)",
      );
      continue;
    }

    if (!SOURCE_EXT.test(file)) continue;

    const viteRoute = viteSpaRoute(file);
    if (viteRoute) {
      push(viteRoute.route, "vite-spa", file, viteRoute.reason);
    }
  }

  if (out.length === 0) {
    const fallback = options.fallbackRoute ?? "/";
    out.push({
      route: normalizeRoute(fallback),
      framework: "config",
      source: changedFiles.length > 0 ? changedFiles.join(", ") : "(no files)",
      reason: "no route-like change detected — capturing the home page",
      dynamic: false,
    });
  }

  return out;
}

/** `src/app/dashboard/page.tsx` -> `/dashboard` (Next.js App Router). */
export function nextAppRoute(
  file: string,
): { route: string; reason: string } | null {
  const match = /^(?:src\/)?app\/(.+)$/.exec(file);
  if (!match) return null;
  const rest = match[1] ?? "";
  const page = basename(rest);
  if (!NEXT_APP_PAGE.test(page)) return null;
  const segments = rest
    .split("/")
    .slice(0, -1)
    // Route groups `(marketing)` and intercepting markers `(.)` add no URL.
    .filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment))
    .map((segment) => segment.replace(/^\(\.+\)/, ""));
  const route = `/${segments.join("/")}`;
  return {
    route: route === "/" ? "/" : route,
    reason: `Next.js App Router page ${file}`,
  };
}

/** `pages/blog/[slug].tsx` -> `/blog/[slug]` (Next.js Pages Router). */
export function nextPagesRoute(
  file: string,
  options: { allowSrcPages?: boolean } = {},
): { route: string; reason: string } | null {
  const match = NEXT_PAGES_FILE.exec(file);
  if (!match) return null;
  if (file.startsWith("src/") && options.allowSrcPages === false) return null;
  const rest = match[1] ?? "";
  if (rest.startsWith("api/")) return null;
  const segments = rest.split("/");
  const last = segments[segments.length - 1] ?? "";
  if (NEXT_PAGES_SKIP.test(last)) return null;
  if (segments[0] === "api") return null;
  if (last === "index") segments.pop();
  const route = `/${segments.join("/")}`;
  return {
    route: route === "/" ? "/" : route,
    reason: `Next.js Pages Router page ${file}`,
  };
}

/** `pricing/index.html` -> `/pricing`, `about.html` -> `/about`. */
export function staticHtmlRoute(file: string): string | null {
  if (!/\.html?$/i.test(file)) return null;
  if (/(^|\/)(node_modules|dist|build|out)\//.test(file)) return null;
  const withoutExt = file.replace(/\.html?$/i, "");
  const segments = withoutExt.split("/");
  const base = segments[segments.length - 1] ?? "";
  if (base === "index" || base === "") {
    segments.pop();
  } else {
    segments[segments.length - 1] = base;
  }
  const route = `/${segments.join("/")}`;
  return normalizeRoute(route);
}

function viteSpaRoute(file: string): { route: string; reason: string } | null {
  const match =
    /^(?:src\/)?(pages|views|routes)\/(.+)\.(tsx|ts|jsx|js|vue|svelte)$/.exec(
      file,
    );
  if (match) {
    const rest = match[2] ?? "";
    const segments = rest.split("/");
    const lastIndex = segments.length - 1;
    const base = segments[lastIndex] ?? "";
    if (base === "index" || base === "Index") {
      segments.pop();
    } else if (lastIndex === 0) {
      segments[0] = kebabCase(base);
    }
    const route = `/${segments.map((segment) => kebabCase(segment)).join("/")}`;
    return { route: normalizeRoute(route), reason: `page file ${file}` };
  }

  const entry =
    /^(?:src\/)?(App|Main|main|index|Root)\.(tsx|ts|jsx|js)$/.exec(file) ??
    /^index\.html?$/i.exec(file);
  if (entry) {
    return { route: "/", reason: `SPA entry file ${file}` };
  }

  if (/^(?:src\/)?components\//.test(file)) {
    return {
      route: "/",
      reason: `shared component ${file} changed — capturing the home page`,
    };
  }

  return null;
}

const ROUTE_DIR_HINTS = /(^|\/)(pages|views|routes|screens|app)(\/|$)/i;

/** Markers that say this repo is a Next.js app (so `src/pages` means routes). */
export function detectNextProject(cwd: string): boolean {
  const markers = [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "next.config.cjs",
    "pages/_app.tsx",
    "pages/_app.jsx",
    "src/pages/_app.tsx",
    "src/pages/_app.jsx",
  ];
  for (const marker of markers) {
    if (existsSync(join(cwd, marker))) return true;
  }
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.next ?? pkg.devDependencies?.next);
  } catch {
    return false;
  }
}

/**
 * Statically scan React Router definition files for `path` + component pairs.
 * This is a heuristic (no bundler, no runtime), deliberately conservative:
 * only literal `path` values are read, so dynamic expressions are skipped.
 */
export function discoverRouterRoutes(
  cwd: string,
  maxFiles = 400,
): RouterRoute[] {
  const files = walkSourceFiles(cwd, maxFiles);
  const routes: RouterRoute[] = [];
  for (const file of files) {
    let source: string;
    try {
      const stat = statSync(join(cwd, file));
      if (stat.size > 400_000) continue;
      source = readFileSync(join(cwd, file), "utf8");
    } catch {
      continue;
    }
    if (
      !/(<Route\b|createBrowserRouter|createRoutesFromElements|useRoutes\()/.test(
        source,
      )
    ) {
      continue;
    }
    routes.push(...parseRouterSource(stripComments(source), file));
  }
  return dedupeRouterRoutes(routes);
}

function dedupeRouterRoutes(routes: RouterRoute[]): RouterRoute[] {
  const seen = new Set<string>();
  const out: RouterRoute[] = [];
  for (const route of routes) {
    const key = `${normalizeRoute(route.route)}|${route.component ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...route, route: normalizeRoute(route.route) });
  }
  return out;
}

/** Changed component file that a React Router route renders, or its definition file. */
function matchRouterRoute(
  file: string,
  routerRoutes: RouterRoute[],
  routerFileSet: Set<string>,
): RouterRoute[] {
  if (routerRoutes.length === 0) return [];
  const key = componentKey(file);
  return routerRoutes.filter(
    (route) =>
      routerFileSet.has(file) ||
      (route.component !== undefined && componentKey(route.component) === key),
  );
}

/**
 * Remove `//` and block comments so documentation examples of `<Route>` or
 * `path: "/pricing"` are not mistaken for real route declarations.
 * String and template literals are skipped so URLs survive intact.
 */
export function stripComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      out += char;
      index += 1;
      while (index < source.length) {
        const current = source[index];
        out += current;
        index += 1;
        if (current === "\\") {
          if (index < source.length) {
            out += source[index];
            index += 1;
          }
          continue;
        }
        if (current === quote) break;
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

export function parseRouterSource(source: string, file: string): RouterRoute[] {
  const routes: RouterRoute[] = [];

  // Scan complete Route tags, respecting quoted attributes and JSX expressions.
  // A regex ending at the first > truncates element={<Layout />} and loses
  // both nesting and self-closing information.
  const stack: Array<{ route: string; component?: string }> = [];
  let cursor = 0;
  const unsupported = (): never => {
    throw new Error(
      `Cannot infer static React Router routes in ${file}; set explicit routes in .proofshot.json or --routes.`,
    );
  };
  while (cursor < source.length) {
    const c = source[cursor];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      cursor++;
      while (cursor < source.length) {
        const ch = source[cursor++];
        if (ch === "\\") cursor++;
        else if (ch === quote) break;
      }
      continue;
    }
    if (source.startsWith("//", cursor)) {
      while (cursor < source.length && source[cursor] !== "\n") cursor++;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const end = source.indexOf("*/", cursor + 2);
      cursor = end < 0 ? source.length : end + 2;
      continue;
    }
    const start = /^<(\/?)Route(?=[\s/>])/.exec(source.slice(cursor));
    if (!start) {
      cursor++;
      continue;
    }
    const closing = start[1] === "/";
    let end = cursor + start[0].length,
      depth = 0,
      quote = "";
    for (; end < source.length; end++) {
      const ch = source[end]!;
      if (quote) {
        if (ch === "\\") end++;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    if (end === source.length) unsupported();
    const attrs = source.slice(cursor + start[0].length, end);
    cursor = end + 1;
    if (closing) {
      if (!stack.length) unsupported();
      stack.pop();
      continue;
    }
    if (/\{\s*\.\.\./.test(attrs)) unsupported();
    const declared = readPathAttribute(attrs);
    if (/\bpath\s*=/.test(attrs) && declared === null) unsupported();
    const parent = stack.at(-1)?.route ?? "/";
    const index = /\bindex(?:\s|=|$)/.test(attrs);
    if (
      index &&
      /\bindex\s*=/.test(attrs) &&
      !/\bindex\s*=\s*\{\s*true\s*\}/.test(attrs)
    )
      unsupported();
    const child = index ? "" : (declared ?? "");
    if (
      child.startsWith("/") &&
      parent !== "/" &&
      child !== parent &&
      !child.startsWith(parent + "/")
    )
      unsupported();
    const route = child.startsWith("/")
      ? normalizeRoute(child)
      : normalizeRoute(`${parent}/${child}`);
    const component = readComponentAttribute(attrs);
    if (declared !== null || index || component)
      routes.push({ route, component, file });
    if (!/\/\s*$/.test(attrs)) stack.push({ route, component });
  }
  if (stack.length) unsupported();
  let match: RegExpExecArray | null;

  // Object style: { path: "/pricing", element: <Pricing /> } or { path, Component }
  const objectPath = /path\s*:\s*(["'`])([^"'`]*)\1/g;
  while ((match = objectPath.exec(source)) !== null) {
    const path = match[2] ?? "";
    if (!path.startsWith("/") && path !== "*") continue;
    const window = source.slice(match.index, match.index + 400);
    const element = /element\s*:\s*<\s*([A-Za-z0-9_$]+)/.exec(window);
    const component = /(?:Component|component)\s*:\s*([A-Za-z0-9_$]+)/.exec(
      window,
    );
    routes.push({
      route: path,
      component: element?.[1] ?? component?.[1],
      file,
    });
  }

  return dedupeRouterRoutes(routes.filter((route) => route.route !== "*"));
}

function readPathAttribute(attrs: string): string | null {
  const literal =
    /path\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/.exec(
      attrs,
    );
  if (literal) {
    const value = literal[1] ?? literal[2] ?? literal[3] ?? null;
    if (value?.includes("${")) return null;
    return value;
  }
  if (/\bindex\b/.test(attrs)) return "";
  return null;
}

function readComponentAttribute(attrs: string): string | undefined {
  const element = /element\s*=\s*\{\s*<\s*([A-Za-z0-9_$]+)/.exec(attrs);
  if (element?.[1]) return element[1];
  const component =
    /(?:Component|component)\s*=\s*(?:\{\s*([A-Za-z0-9_$]+)|"([^"]+)")/.exec(
      attrs,
    );
  return component?.[1] ?? component?.[2];
}

function walkSourceFiles(cwd: string, maxFiles: number): string[] {
  const out: string[] = [];
  const roots = ["src", "app", "pages", "routes"];
  const queue: string[] = [];

  for (const root of roots) {
    try {
      if (statSync(join(cwd, root)).isDirectory()) queue.push(root);
    } catch {
      // root missing; ignore
    }
  }

  while (queue.length > 0 && out.length < maxFiles) {
    const dir = queue.shift();
    if (!dir) break;
    let entries: string[];
    try {
      entries = readdirSync(join(cwd, dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const rel = `${dir}/${entry}`;
      let stat;
      try {
        stat = statSync(join(cwd, rel));
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (rel.split("/").length <= 6) queue.push(rel);
        continue;
      }
      if (!/\.(tsx|jsx|ts|js|mjs)$/.test(entry)) continue;
      if (/(^|\/)(__tests__|__mocks__)\//.test(rel)) continue;
      out.push(rel);
    }
  }

  // Router definitions often live in App.tsx at the root of src/; those are
  // already covered. Also look at a couple of conventional root files.
  for (const candidate of [
    "src/App.tsx",
    "src/App.jsx",
    "src/main.tsx",
    "src/main.jsx",
  ]) {
    if (out.length >= maxFiles) break;
    if (out.includes(candidate)) continue;
    try {
      if (statSync(join(cwd, candidate)).isFile()) out.push(candidate);
    } catch {
      // ignore
    }
  }

  return out;
}
