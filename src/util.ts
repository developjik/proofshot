import { createHash } from "node:crypto";

/** Paths and strings arrive with either separator depending on the platform. */
export function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function basename(filePath: string): string {
  const parts = toPosix(filePath).split("/");
  return parts[parts.length - 1] ?? filePath;
}

export function stripExt(name: string): string {
  const base = basename(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** A case-insensitive key used to match `Dashboard.tsx` with `<Dashboard />`. */
export function componentKey(value: string): string {
  return stripExt(value)
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

export function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export function normalizeRoute(route: string): string {
  let next = route.trim();
  if (!next.startsWith("/")) next = `/${next}`;
  next = next.replace(/\/{2,}/g, "/");
  if (next.length > 1) next = next.replace(/\/+$/, "");
  return next === "" ? "/" : next;
}

export function isDynamicRoute(route: string): boolean {
  return /\[[^\]]+\]|:[A-Za-z_][A-Za-z0-9_]*/.test(route);
}

/** `"/"` -> `"root"`, `"/blog/[slug]"` -> `"blog-slug"`. Used for file names. */
export function routeSlug(route: string): string {
  const slug = normalizeRoute(route)
    .replace(/[[\]:]+/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug === "" ? "root" : slug;
}

/** Stable identity for an image artifact; the readable slug is not unique. */
export function routeArtifactId(route: string): string {
  const normalized = normalizeRoute(route);
  return `${routeSlug(normalized).slice(0, 32)}-${createHash("sha256").update(normalized).digest("hex").slice(0, 32)}`;
}

const IGNORED_SEGMENT =
  /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.github|__tests__|__mocks__|e2e)(\/|$)/;
const IGNORED_FILE =
  /(\.test\.|\.spec\.|\.stories\.|\.d\.ts$|\.snap$|(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig[^/]*\.json)$)/i;
const DOC_FILE = /\.(md|mdx|txt|json|ya?ml|toml|lock|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/i;

/** Files that can never point at a screen. */
export function isIgnoredSource(file: string): boolean {
  const posix = toPosix(file).replace(/^\.\//, "");
  if (IGNORED_SEGMENT.test(posix)) return true;
  if (IGNORED_FILE.test(posix)) return true;
  return false;
}

export function isStyleSheet(file: string): boolean {
  return /\.(css|scss|sass|less|styl)$/i.test(file);
}

export function isDocumentation(file: string): boolean {
  return DOC_FILE.test(file);
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return "—";
  if (percent === 0) return "0%";
  if (percent < 0.01) return `${percent.toFixed(4)}%`;
  return `${percent.toFixed(2)}%`;
}

export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function isUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

/** Scene identity hashes raw structured data, never path-normalized user names. */
export function sceneArtifactId(route: string, name: string): string {
  return `scene-${createHash("sha256").update(JSON.stringify([normalizeRoute(route), name])).digest("hex")}`;
}

/** Browser-equivalent local route identity, without decoding encoded separators. */
export function routeIdentity(route: string, staticFilename = false): string {
  const url = new URL(normalizeRoute(route), 'http://proofshot.invalid');
  if (staticFilename) url.pathname = url.pathname.replace(/%[0-9a-f]{2}/gi, escape => escape.toUpperCase());
  return url.href;
}
