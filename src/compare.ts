import { computeAxeDelta } from './axe';
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { applyRouteParams, loadConfig } from "./config";
import { computeA11yDelta } from "./a11y";
import { comparePngs } from "./diff";
import { changedFiles, shortSha } from "./git";
import { captureSide, DEFAULT_VIEWPORTS, type PageCapture } from "./capture";
import {
  computeStats,
  writeReport,
  type ComparisonResult,
  type ReportStats,
} from "./report";
import { discoverRouterRoutes, detectNextProject, inferRoutes } from "./routes";
import { normalizeScenes } from './scenes';
import type { SceneSpec, ProofshotConfig, ProofshotMeta, ViewportSpec } from "./types";
import { formatPercent, isUrl, normalizeRoute, routeArtifactId, sceneArtifactId, uniqueBy } from "./util";

export type FailOn = "change" | "a11y" | "error";

export interface CompareOptions {
  cwd?: string;
  /** Build directory or URL for the base side. */
  base?: string;
  /** Build directory or URL for the head side. */
  head?: string;
  baseRef?: string;
  headRef?: string;
  routes?: string[];
  scenes?: SceneSpec[];
  configPath?: string;
  outDir?: string;
  threshold?: number;
  viewports?: ViewportSpec[];
  fullPage?: boolean;
  settleMs?: number;
  collectA11y?: boolean;
  axe?: boolean;
  failOn?: FailOn[];
  log?: (message: string) => void;
}

export interface CompareOutcome {
  outDir: string;
  reportPath: string;
  jsonPath: string;
  meta: ProofshotMeta;
  results: ComparisonResult[];
  stats: ReportStats;
  failures: string[];
  exitCode: number;
}

/**
 * Capture base and head, diff every route × viewport pair, compare a11y, and
 * write `report.md` + `report.json` with the screenshots beside them.
 */
export async function runCompare(options: CompareOptions = {}): Promise<CompareOutcome> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const log = options.log ?? (() => undefined);
  const { config, path: configPath } = loadConfig(cwd, options.configPath);
  const notes: string[] = [];

  const base = firstNonEmpty(options.base, config.base, config.baseUrl);
  const head = firstNonEmpty(options.head, config.head, config.headUrl);
  if (!base || !head) {
    throw new Error(
      "proofshot: both sides are required — pass --base <dir|url> and --head <dir|url> " +
        "(or set `base` / `head` in .proofshot.json)",
    );
  }

  const thresholdPercent = options.threshold ?? config.threshold ?? 0.1;
  const viewports = options.viewports ?? config.viewports ?? DEFAULT_VIEWPORTS;
  const outDir = resolve(cwd, options.outDir ?? config.outDir ?? "proofshot-out");
  const collectA11y = options.collectA11y ?? config.a11y ?? true;

  const { routes, routesSource } = resolveRoutes({
    cwd,
    explicit: options.routes,
    config,
    baseRef: options.baseRef,
    headRef: options.headRef,
    notes,
  });
  if (routes.length === 0) {
    throw new Error("proofshot: no routes to capture — pass --routes /,/pricing");
  }
  if (routes.some((route) => /\[[^\]]+\]|:[A-Za-z_]/.test(route))) {
    notes.push(
      "A route still has a dynamic placeholder; set `params` in .proofshot.json to give it a real value.",
    );
  }

  const scenes = normalizeScenes(options.scenes ?? config.scenes ?? []).map(scene => ({ ...scene, route: normalizeRoute(applyRouteParams(scene.route, config.params).route) })).filter(scene => routes.includes(scene.route));

  await mkdir(outDir, { recursive: true });

  log(`proofshot: base ${describeSource(base)} · head ${describeSource(head)}`);
  log(`proofshot: ${routes.length} route(s) × ${viewports.length} viewport(s), threshold ${formatPercent(thresholdPercent)}`);

  const [baseSide, headSide] = await Promise.all([
    captureSide({
      target: base,
      routes,
      scenes,
      viewports,
      outDir,
      side: "base",
      fullPage: options.fullPage ?? config.fullPage,
      settleMs: options.settleMs ?? config.settleMs,
      collectA11y,
      axe: options.axe,
      axeCwd: cwd,
    }),
    captureSide({
      target: head,
      routes,
      scenes,
      viewports,
      outDir,
      side: "head",
      fullPage: options.fullPage ?? config.fullPage,
      settleMs: options.settleMs ?? config.settleMs,
      collectA11y,
      axe: options.axe,
      axeCwd: cwd,
    }),
  ]);

  for (const capture of [...baseSide.captures, ...headSide.captures]) {
    if (capture.error) {
      log(`proofshot: capture failed for ${capture.side} ${capture.route} (${capture.viewport}): ${capture.error}`);
    }
  }

  const results: ComparisonResult[] = [];
  for (const job of [...routes.map(route => ({ route, scene: undefined as string | undefined })), ...scenes.map(scene => ({ route: scene.route, scene: scene.name }))]) {
    const { route, scene } = job;
    for (const viewport of viewports) {
      results.push(
        await comparePair({
          route,
          scene,
          viewport: viewport.name,
          base: baseSide.captures.find(
            (capture) => capture.route === route && capture.scene === scene && capture.viewport === viewport.name,
          ),
          head: headSide.captures.find(
            (capture) => capture.route === route && capture.scene === scene && capture.viewport === viewport.name,
          ),
          outDir,
          thresholdPercent,
        }),
      );
    }
  }

  const baseRef = options.baseRef;
  const headRef = options.headRef;
  const meta: ProofshotMeta = {
    baseLabel: refLabel(cwd, baseRef, base),
    headLabel: refLabel(cwd, headRef, head),
    baseSource: base,
    headSource: head,
    baseRef,
    headRef,
    routes,
    routesSource,
    viewports: viewports.map((viewport) => viewport.name),
    thresholdPercent,
    generatedAt: new Date().toISOString(),
    notes,
  };

  const { markdownPath, jsonPath } = await writeReport(outDir, meta, results);
  const stats = computeStats(results);

  const failures: string[] = [];
  const failOn = options.failOn ?? [];
  if (failOn.includes("error") && stats.errors > 0) {
    failures.push(`${stats.errors} capture(s) failed`);
  }
  if (failOn.includes("a11y") && stats.a11yRegressions > 0) {
    failures.push(`${stats.a11yRegressions} view(s) introduced new a11y issues`);
  }
  if (failOn.includes("change") && stats.changed > 0) {
    failures.push(`${stats.changed} view(s) changed beyond ${formatPercent(thresholdPercent)}`);
  }

  log(
    `proofshot: ${stats.changed} changed · ${stats.unchanged} unchanged · ${stats.errors} failed` +
      (stats.a11yRegressions > 0 ? ` · ${stats.a11yRegressions} a11y regression(s)` : ""),
  );
  log(`proofshot: report ${markdownPath}`);

  return {
    outDir,
    reportPath: markdownPath,
    jsonPath,
    meta,
    results,
    stats,
    failures,
    exitCode: failures.length > 0 ? 1 : 0,
  };
}

function resolveRoutes(input: {
  cwd: string;
  explicit?: string[];
  config: ProofshotConfig;
  baseRef?: string;
  headRef?: string;
  notes: string[];
}): { routes: string[]; routesSource: string } {
  let candidates;
  let source: string;
  const params = input.config.params;

  if (input.explicit && input.explicit.length > 0) {
    candidates = input.explicit.map((route) => ({
      route: normalizeRoute(route),
      framework: "config" as const,
      source: "--routes",
      reason: "explicit --routes",
    }));
    source = "CLI --routes";
  } else if (input.config.routes && input.config.routes.length > 0) {
    candidates = inferRoutes([], { config: input.config });
    source = ".proofshot.json routes";
  } else {
    const changed = changedFiles({
      cwd: input.cwd,
      baseRef: input.baseRef,
      headRef: input.headRef,
    });
    if (changed.warning) input.notes.push(changed.warning);
    const routerRoutes = discoverRouterRoutes(input.cwd);
    candidates = inferRoutes(changed.files, {
      config: input.config,
      routerRoutes,
      nextProject: detectNextProject(input.cwd),
    });
    source =
      changed.files.length > 0
        ? `git diff ${changed.range} (${changed.files.length} file(s))`
        : "no changes detected — home page";
  }

  const resolved = candidates.map((candidate) => {
    const applied = applyRouteParams(candidate.route, params);
    if (applied.unresolved.length > 0) {
      input.notes.push(
        `Route ${candidate.route} needs param(s) ${applied.unresolved.join(", ")}; captured as-is.`,
      );
    }
    return { ...candidate, route: normalizeRoute(applied.route) };
  });

  const unique = uniqueBy(resolved, (candidate) => candidate.route);
  return { routes: unique.map((candidate) => candidate.route), routesSource: source };
}

async function comparePair(input: {
  route: string;
  scene?: string;
  viewport: string;
  base?: PageCapture;
  head?: PageCapture;
  outDir: string;
  thresholdPercent: number;
}): Promise<ComparisonResult> {
  const { route, scene, viewport, base, head, outDir, thresholdPercent } = input;
  const result: ComparisonResult = {
    route,
    ...(scene ? { scene } : {}),
    viewport,
    status: "unchanged",
    diffPercent: null,
    diffPixels: 0,
    width: null,
    height: null,
    sizeMismatch: false,
    images: {
      before: base?.screenshotPath ? basename(base.screenshotPath) : undefined,
      after: head?.screenshotPath ? basename(head.screenshotPath) : undefined,
    },
    a11y: null,
    consoleErrors: {
      before: base?.a11y?.counts.consoleErrors ?? base?.consoleErrors.length ?? 0,
      after: head?.a11y?.counts.consoleErrors ?? head?.consoleErrors.length ?? 0,
    },
  };

  const error = base?.error ?? head?.error;
  if (error || !base?.screenshotPath || !head?.screenshotPath) {
    result.status = "error";
    if (base?.blocked || head?.blocked) result.blocked = true;
    result.error = error ?? "screenshot missing for one side";
  } else {
    const diff = comparePngs(
      await readFile(base.screenshotPath),
      await readFile(head.screenshotPath),
    );
    result.diffPercent = diff.diffPercent;
    result.diffPixels = diff.changedPixels;
    result.width = diff.width;
    result.height = diff.height;
    result.sizeMismatch = diff.sizeMismatch;
    result.sizes = { before: diff.before, after: diff.after };
    result.status = diff.diffPercent > thresholdPercent ? "changed" : "unchanged";
    if (diff.changedPixels > 0) {
      const artifact = scene ? sceneArtifactId(route, scene) : routeArtifactId(route);
      const diffName = `${artifact}-${viewport}-diff.png`;
      await writeFile(resolve(outDir, diffName), diff.diffPng);
      result.images.diff = diffName;
    }
  }

  if (base?.a11y && head?.a11y) {
    result.a11y = computeA11yDelta(base.a11y, head.a11y);
  }

  if (base?.axe && head?.axe) result.axe = computeAxeDelta(base.axe, head.axe);
  return result;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

function describeSource(source: string): string {
  return isUrl(source) ? source : `dir ${source}`;
}

function refLabel(cwd: string, ref: string | undefined, source: string): string {
  if (!ref) return source;
  const sha = shortSha(cwd, ref);
  return sha ? `${ref}@${sha}` : ref;
}
