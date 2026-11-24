/** Which way a route candidate was discovered. */
export type RouteFramework =
  | "next-app"
  | "next-pages"
  | "react-router"
  | "vite-spa"
  | "static"
  | "config";

/** A page worth capturing, inferred from changed files (or listed in config). */
export interface RouteCandidate {
  /** URL path, e.g. `/`, `/dashboard`, `/blog/[slug]`. */
  route: string;
  framework: RouteFramework;
  /** The changed file (or config file) that produced this candidate. */
  source: string;
  /** Human-readable reason, shown by `proofshot routes`. */
  reason: string;
  /** True when the route still contains `[param]` / `:param` placeholders. */
  dynamic?: boolean;
}

/** A route parsed out of a React Router definition file. */
export interface RouterRoute {
  ancestors?: string[];
  route: string;
  component?: string;
  /** File the route was declared in, relative to the project root. */
  file: string;
}

export interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

/** Contents of `.proofshot.json` (all keys optional). */
export interface ProofshotConfig {
  /** Explicit routes. When present they replace route inference. */
  routes?: string[];
  scenes?: SceneSpec[];
  /** Base and head to capture: a build directory or an http(s) URL. */
  base?: string;
  head?: string;
  /** Aliases for base/head, for people who think in URLs. */
  baseUrl?: string;
  headUrl?: string;
  viewports?: ViewportSpec[];
  /** Pixel-diff percentage treated as "changed". Default 0.1. */
  threshold?: number;
  fullPage?: boolean;
  /** Milliseconds to wait after `load` before the screenshot. Default 400. */
  settleMs?: number;
  a11y?: boolean;
  /** Values for dynamic route placeholders, e.g. `{ "slug": "hello" }`. */
  params?: Record<string, string>;
  outDir?: string;
}

export interface ProofshotMeta {
  baseLabel: string;
  headLabel: string;
  baseSource: string;
  headSource: string;
  baseRef?: string;
  headRef?: string;
  routes: string[];
  routesSource: string;
  viewports: string[];
  thresholdPercent: number;
  generatedAt: string;
  notes: string[];
}


export interface SceneStep {
  action: 'click' | 'fill' | 'press' | 'wait';
  selector?: string;
  /** Exact visible text, as an alternative to a CSS selector. */
  text?: string;
  value?: string;
  timeoutMs?: number;
}
export interface SceneSpec {
  name: string;
  route: string;
  steps: SceneStep[];
  /** CSS selector that must be visible after all steps. */
  expect?: string;
}
