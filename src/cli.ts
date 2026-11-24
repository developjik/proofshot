import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseViewports } from "./capture";
import { applyRouteParams, loadConfig } from "./config";
import { runCompare, type FailOn } from "./compare";
import { changedFiles } from "./git";
import { runInit, WORKFLOW_PATH } from "./init";
import { detectNextProject, discoverRouterRoutes, inferRoutes } from "./routes";
import { normalizeRoute, routeIdentity } from './util';
import type { ViewportSpec } from "./types";

export interface CliContext {
  entry?: string;
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

interface ParsedArgs {
  command?: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "json",
  "quiet",
  "full-page",
  "no-full-page",
  "a11y",
  "no-a11y",
  "force",
]);

const VALUE_FLAGS = new Set([
  "base",
  "head",
  "base-url",
  "head-url",
  "routes",
  "files",
  "base-ref",
  "head-ref",
  "config",
  "out",
  "threshold",
  "viewports",
  "settle",
  "fail-on",
]);

export async function runCli(
  argv: string[],
  context: CliContext = {},
): Promise<number> {
  const out =
    context.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err =
    context.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    err(`proofshot: ${(error as Error).message}`);
    err("Run `proofshot --help` for usage.");
    return 2;
  }

  if (parsed.flags.has("version")) {
    out(readVersion());
    return 0;
  }
  if (parsed.flags.has("help") || parsed.command === undefined) {
    out(helpText());
    return 0;
  }

  const quiet = parsed.flags.has("quiet");
  try {
    switch (parsed.command) {
      case "compare":
        return await commandCompare(parsed, {
          cwd: context.cwd ?? process.cwd(),
          out,
          err,
          quiet,
        });
      case "routes":
        return await commandRoutes(parsed, {
          cwd: context.cwd ?? process.cwd(),
          out,
        });
      case "init":
        return await commandInit(parsed, {
          cwd: context.cwd ?? process.cwd(),
          out,
        });
      default:
        err(`proofshot: unknown command "${parsed.command}"`);
        err("Run `proofshot --help` for usage.");
        return 2;
    }
  } catch (error) {
    err(`proofshot: ${(error as Error).message}`);
    return 1;
  }
}

async function commandCompare(
  parsed: ParsedArgs,
  ctx: {
    cwd: string;
    out: (line: string) => void;
    err: (line: string) => void;
    quiet: boolean;
  },
): Promise<number> {
  const failOn = String(parsed.flags.get("fail-on") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(
      (value): value is FailOn =>
        value === "change" || value === "a11y" || value === "error",
    );

  const thresholdRaw = parsed.flags.get("threshold");
  const threshold =
    thresholdRaw === undefined ? undefined : Number(thresholdRaw);
  if (
    threshold !== undefined &&
    (!Number.isFinite(threshold) || threshold < 0)
  ) {
    throw new Error("--threshold must be a non-negative number (percent)");
  }

  const routesRaw = parsed.flags.get("routes");
  const routes =
    typeof routesRaw === "string" && routesRaw.trim() !== ""
      ? routesRaw
          .split(",")
          .map((route) => route.trim())
          .filter(Boolean)
      : undefined;

  const settleRaw = parsed.flags.get("settle");
  const settleMs = settleRaw === undefined ? undefined : Number(settleRaw);
  if (settleMs !== undefined && (!Number.isFinite(settleMs) || settleMs < 0)) {
    throw new Error("--settle must be a non-negative number of milliseconds");
  }

  const viewports = parseViewports(stringFlag(parsed.flags.get("viewports")));

  const outcome = await runCompare({
    cwd: ctx.cwd,
    base: stringFlag(parsed.flags.get("base") ?? parsed.flags.get("base-url")),
    head: stringFlag(parsed.flags.get("head") ?? parsed.flags.get("head-url")),
    baseRef: stringFlag(parsed.flags.get("base-ref")),
    headRef: stringFlag(parsed.flags.get("head-ref")),
    routes,
    configPath: stringFlag(parsed.flags.get("config")),
    outDir: stringFlag(parsed.flags.get("out")),
    threshold,
    viewports,
    fullPage: parsed.flags.has("no-full-page")
      ? false
      : parsed.flags.has("full-page")
        ? true
        : undefined,
    settleMs,
    axe: parsed.flags.get("a11y") === "axe",
    collectA11y: parsed.flags.has("no-a11y")
      ? false
      : parsed.flags.has("a11y")
        ? true
        : undefined,
    failOn,
    log: ctx.quiet ? () => undefined : ctx.out,
  });

  if (parsed.flags.has("json")) {
    ctx.out(
      JSON.stringify(
        {
          reportPath: outcome.reportPath,
          jsonPath: outcome.jsonPath,
          meta: outcome.meta,
          stats: outcome.stats,
          failures: outcome.failures,
          results: outcome.results,
        },
        null,
        2,
      ),
    );
  } else {
    ctx.out(summaryTable(outcome.results));
    ctx.out("");
    ctx.out(`report: ${outcome.reportPath}`);
    if (outcome.failures.length > 0) {
      for (const failure of outcome.failures) ctx.err(`proofshot: ${failure}`);
    }
  }

  return outcome.exitCode;
}

async function commandRoutes(
  parsed: ParsedArgs,
  ctx: { cwd: string; out: (line: string) => void },
): Promise<number> {
  const filesFlag = stringFlag(parsed.flags.get("files"));
  const explicitFiles = filesFlag
    ? filesFlag
        .split(",")
        .map((file) => file.trim())
        .filter(Boolean)
    : undefined;

  const { config } = loadConfig(
    ctx.cwd,
    stringFlag(parsed.flags.get("config")),
  );
  const diff = explicitFiles
    ? { files: explicitFiles, range: "(files)", warning: undefined }
    : changedFiles({
        cwd: ctx.cwd,
        baseRef: stringFlag(parsed.flags.get("base-ref")),
        headRef: stringFlag(parsed.flags.get("head-ref")),
      });

  const routerRoutes = config.routes?.length
    ? []
    : discoverRouterRoutes(ctx.cwd);
  const candidates = inferRoutes(diff.files, {
    gitPaths: !explicitFiles,
    config,
    routerRoutes,
    nextProject: detectNextProject(ctx.cwd),
  });

  if (parsed.flags.has("json")) {
    const scenes = config.scenes?.map(scene => ({ ...scene, route: normalizeRoute(applyRouteParams(scene.route, config.params).route) })).filter(scene => candidates.some(candidate => routeIdentity(applyRouteParams(candidate.route, config.params).route, candidate.framework === "static") === routeIdentity(scene.route, candidate.framework === "static")));
    ctx.out(
      JSON.stringify(
        { range: diff.range, files: diff.files, routes: candidates, ...(scenes?.length ? { scenes } : {}) },
        null,
        2,
      ),
    );
    return 0;
  }

  if (diff.warning) ctx.out(`note: ${diff.warning}`);
  ctx.out(
    `${candidates.length} route(s) from ${diff.files.length} changed file(s) (${diff.range})`,
  );
  ctx.out("");
  const width = Math.max(
    5,
    ...candidates.map((candidate) => candidate.route.length),
  );
  const frameworkWidth = Math.max(
    9,
    ...candidates.map((candidate) => candidate.framework.length),
  );
  ctx.out(
    `${"ROUTE".padEnd(width)}  ${"FRAMEWORK".padEnd(frameworkWidth)}  SOURCE`,
  );
  ctx.out(
    `${"-".repeat(width)}  ${"-".repeat(frameworkWidth)}  ${"-".repeat(30)}`,
  );
  for (const candidate of candidates) {
    ctx.out(
      `${terminalSafe(candidate.route).padEnd(width)}  ${candidate.framework.padEnd(frameworkWidth)}  ${terminalSafe(candidate.source)}`,
    );
  }
  if (config.scenes?.length) {
    for (const scene of config.scenes.map(scene => ({ ...scene, route: normalizeRoute(applyRouteParams(scene.route, config.params).route) })).filter(scene => candidates.some(candidate => routeIdentity(applyRouteParams(candidate.route, config.params).route, candidate.framework === "static") === routeIdentity(scene.route, candidate.framework === "static")))) ctx.out(`scene: ${scene.name} (${scene.route})`);
  }
  return 0;
}

async function commandInit(
  parsed: ParsedArgs,
  ctx: { cwd: string; out: (line: string) => void },
): Promise<number> {
  const result = await runInit({
    cwd: ctx.cwd,
    force: parsed.flags.has("force"),
  });
  if (result.created) {
    ctx.out(`created ${WORKFLOW_PATH}`);
    ctx.out(`path: ${result.path}`);
  } else {
    ctx.out(`skipped: ${result.reason ?? "workflow already exists"}`);
  }
  return 0;
}

function summaryTable(
  results: Array<{
    route: string;
    scene?: string;
    blocked?: boolean;
    viewport: string;
    status: string;
    diffPercent: number | null;
    a11y?: { regressions: unknown[]; fixes: unknown[] } | null;
    axe?: { regressions: unknown[]; fixes: unknown[] };
    consoleErrors: { before: number; after: number };
  }>,
): string {
  const lines: string[] = [];
  const routeWidth = Math.max(
    5,
    ...results.map((result) => (result.scene ? `${result.route} [${result.scene}]` : result.route).length),
  );
  const viewportWidth = Math.max(
    8,
    ...results.map((result) => result.viewport.length),
  );
  lines.push(
    `${"ROUTE".padEnd(routeWidth)}  ${"VIEWPORT".padEnd(viewportWidth)}  ${"DIFF".padStart(9)}  A11Y   CONSOLE  STATUS`,
  );
  for (const result of results) {
    const diff =
      result.diffPercent === null
        ? "—"
        : `${result.diffPercent.toFixed(2)}%`.padStart(9);
    const net =
      (result.a11y
        ? result.a11y.regressions.length - result.a11y.fixes.length
        : 0) +
      (result.axe
        ? result.axe.regressions.length - result.axe.fixes.length
        : 0);
    const a11y =
      net === 0 ? "0".padStart(4) : `${net > 0 ? "+" : ""}${net}`.padStart(4);
    const consoleCell =
      `${result.consoleErrors.before}→${result.consoleErrors.after}`.padStart(
        7,
      );
    lines.push(
      `${(result.scene ? `${result.route} [${result.scene}]` : result.route).padEnd(routeWidth)}  ${result.viewport.padEnd(viewportWidth)}  ${diff}  ${a11y}  ${consoleCell}  ${result.blocked ? 'blocked' : result.status}`,
    );
  }
  return lines.join("\n");
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  let command: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (argument === "-h") {
      flags.set("help", true);
      continue;
    }
    if (argument === "-v") {
      flags.set("version", true);
      continue;
    }
    if (argument.startsWith("--")) {
      const body = argument.slice(2);
      const equals = body.indexOf("=");
      const name = equals === -1 ? body : body.slice(0, equals);
      const inlineValue = equals === -1 ? undefined : body.slice(equals + 1);
      if (!BOOLEAN_FLAGS.has(name) && !VALUE_FLAGS.has(name)) {
        throw new Error(`unknown option --${name}`);
      }
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
      } else if (name === "a11y" && argv[index + 1] === "axe") {
        flags.set(name, "axe");
        index += 1;
      } else if (BOOLEAN_FLAGS.has(name)) {
        flags.set(name, true);
      } else {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new Error(`--${name} needs a value`);
        }
        flags.set(name, value);
        index += 1;
      }
      continue;
    }
    if (command === undefined) {
      command = argument;
    } else {
      positionals.push(argument);
    }
  }

  return { command, positionals, flags };
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readVersion(): string {
  const candidates: string[] = [];
  if (typeof __dirname !== "undefined") {
    candidates.push(
      resolve(__dirname, "../package.json"),
      resolve(__dirname, "../../package.json"),
    );
  }
  candidates.push(resolve(process.cwd(), "package.json"));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (parsed.name === "@developjik/proofshot" && parsed.version)
        return parsed.version;
    } catch {
      // try the next location
    }
  }
  return "0.0.0";
}

export function helpText(): string {
  return `proofshot ${readVersion()} — before/after screenshots, pixel diff, and a11y deltas for PRs.

Usage:
  proofshot compare --base <dir|url> --head <dir|url> [options]
  proofshot routes [--base-ref main] [--head-ref HEAD]
  proofshot init [--force]

compare:
  --base, --head            build directory or URL to capture (or set them in .proofshot.json)
  --base-url, --head-url    aliases for --base / --head
  --routes <list>           comma-separated routes, e.g. /,/pricing,/dashboard
  --base-ref <ref>          base git ref for route inference (default origin/main)
  --head-ref <ref>          head git ref (default HEAD)
  --config <path>           config file (default .proofshot.json)
  --out <dir>               output directory (default proofshot-out)
  --threshold <percent>     change threshold in percent (default 0.1)
  --viewports <list>        desktop,mobile or phone=390x844 (default desktop,mobile)
  --full-page, --no-full-page
  --settle <ms>             wait after load before screenshotting (default 400)
  --a11y, --no-a11y         run the accessibility delta (default on)
  --a11y axe               additionally run optional axe-core (default off)
  --fail-on <list>          change,a11y,error — exit 1 when any occurs
  --json                    print the machine-readable report
  --quiet                   suppress progress lines

routes:
  --files <list>            infer from an explicit file list instead of git
  --base-ref, --head-ref    git range to diff (default origin/main...HEAD)
  --config <path>
  --json

init:
  --force                   overwrite an existing ${WORKFLOW_PATH}

Exit codes: 0 ok · 1 failed capture / --fail-on triggered · 2 usage error.`;
}

/** Convert the CLI's viewport names into specs (exported for tests). */
export function resolveViewports(names: string[]): ViewportSpec[] {
  const specs = parseViewports(names.join(","));
  if (!specs) throw new Error("no viewports given");
  return specs;
}

/** Keep untrusted filenames from emitting terminal control sequences. JSON mode stays lossless. */
function terminalSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`);
}
