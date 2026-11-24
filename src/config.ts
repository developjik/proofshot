import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProofshotConfig, ViewportSpec } from "./types";
import { normalizeScenes } from './scenes';
import { normalizeRoute } from "./util";

export interface LoadedConfig {
  config: ProofshotConfig;
  /** Absolute path when a config file was found. */
  path?: string;
}

const CONFIG_NAMES = [".proofshot.json", "proofshot.config.json"];

export function loadConfig(cwd: string, configPath?: string): LoadedConfig {
  let file: string | undefined;
  if (configPath) {
    file = resolve(cwd, configPath);
    if (!existsSync(file)) {
      throw new Error(`proofshot: config file not found: ${configPath}`);
    }
  } else {
    for (const name of CONFIG_NAMES) {
      const candidate = join(cwd, name);
      if (existsSync(candidate)) {
        file = candidate;
        break;
      }
    }
  }
  if (!file) return { config: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`proofshot: ${file} is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`proofshot: ${file} must contain a JSON object`);
  }

  return { config: normalizeConfig(parsed as Record<string, unknown>), path: file };
}

function normalizeConfig(raw: Record<string, unknown>): ProofshotConfig {
  const config: ProofshotConfig = {};

  if (raw.routes !== undefined) {
    if (!Array.isArray(raw.routes) || raw.routes.some((route) => typeof route !== "string")) {
      throw new Error("proofshot: config `routes` must be an array of strings");
    }
    config.routes = (raw.routes as string[]).map(normalizeRoute);
  }

  for (const key of ["base", "head", "baseUrl", "headUrl", "outDir"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`proofshot: config \`${key}\` must be a non-empty string`);
    }
    config[key] = value;
  }

  if (raw.threshold !== undefined) {
    if (typeof raw.threshold !== "number" || raw.threshold < 0) {
      throw new Error("proofshot: config `threshold` must be a non-negative number (percent)");
    }
    config.threshold = raw.threshold;
  }

  if (raw.viewports !== undefined) {
    if (!Array.isArray(raw.viewports)) {
      throw new Error("proofshot: config `viewports` must be an array");
    }
    config.viewports = raw.viewports.map((entry, index) => {
      const viewport = entry as Partial<ViewportSpec>;
      if (
        typeof viewport?.name !== "string" ||
        typeof viewport.width !== "number" ||
        typeof viewport.height !== "number"
      ) {
        throw new Error(
          `proofshot: config viewports[${index}] needs { name, width, height }`,
        );
      }
      return {
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor,
      };
    });
  }

  if (raw.fullPage !== undefined) {
    if (typeof raw.fullPage !== "boolean") {
      throw new Error("proofshot: config `fullPage` must be a boolean");
    }
    config.fullPage = raw.fullPage;
  }

  if (raw.settleMs !== undefined) {
    if (typeof raw.settleMs !== "number" || raw.settleMs < 0) {
      throw new Error("proofshot: config `settleMs` must be a non-negative number");
    }
    config.settleMs = raw.settleMs;
  }

  if (raw.a11y !== undefined) {
    if (typeof raw.a11y !== "boolean") {
      throw new Error("proofshot: config `a11y` must be a boolean");
    }
    config.a11y = raw.a11y;
  }

  if (raw.params !== undefined) {
    if (typeof raw.params !== "object" || raw.params === null || Array.isArray(raw.params)) {
      throw new Error("proofshot: config `params` must be an object of name → value");
    }
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.params as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new Error(`proofshot: config params.${key} must be a string`);
      }
      params[key] = value;
    }
    config.params = params;
  }

  if (raw.scenes !== undefined) config.scenes = normalizeScenes(raw.scenes);
  return config;
}

/** Replace `[slug]` / `:slug` placeholders using configured params. */
export function applyRouteParams(
  route: string,
  params?: Record<string, string>,
): { route: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const replaced = normalizeRoute(route)
    .replace(/\[([^\]]+)\]/g, (match, name: string) => {
      const value = params?.[name];
      if (value === undefined) {
        unresolved.push(name);
        return match;
      }
      return value;
    })
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (match, name: string) => {
      const value = params?.[name];
      if (value === undefined) {
        unresolved.push(name);
        return match;
      }
      return value;
    });
  return { route: replaced, unresolved };
}
