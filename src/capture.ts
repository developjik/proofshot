import { captureAxe, type AxeSnapshot } from './axe';
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { normalizeScenes } from './scenes';
import type { SceneSpec, ViewportSpec } from "./types";
import { captureA11y, type A11ySnapshot } from "./a11y";
import { serveDirectory, type StaticServer } from "./serve";
import { isUrl, normalizeRoute, routeArtifactId } from "./util";

export const DEFAULT_VIEWPORTS: ViewportSpec[] = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

export interface CaptureOptions {
  /** Build directory or http(s) URL. */
  target: string;
  routes: string[];
  scenes?: SceneSpec[];
  viewports?: ViewportSpec[];
  outDir: string;
  side: "base" | "head";
  fullPage?: boolean;
  settleMs?: number;
  timeoutMs?: number;
  collectA11y?: boolean;
  axe?: boolean;
  axeCwd?: string;
}

export interface PageCapture {
  scene?: string;
  blocked?: boolean;
  route: string;
  viewport: string;
  side: "base" | "head";
  url: string;
  width?: number;
  height?: number;
  screenshotPath?: string;
  a11y?: A11ySnapshot;
  axe?: AxeSnapshot;
  consoleErrors: string[];
  error?: string;
}

export interface CaptureSideResult {
  captures: PageCapture[];
  origin: string;
  /** Directory served for this side, when the target was a build directory. */
  servedRoot?: string;
}

/**
 * Screenshot every route × viewport for one side of a comparison.
 * A failed page is recorded with its error and does not stop the run.
 */
export async function captureSide(options: CaptureOptions): Promise<CaptureSideResult> {
  const scenes = options.scenes ? normalizeScenes(options.scenes) : [];
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });

  let server: StaticServer | undefined;
  let origin: string;
  if (isUrl(options.target)) {
    origin = options.target.replace(/\/+$/, "");
  } else {
    server = await serveDirectory(options.target);
    origin = server.url;
  }

  const captures: PageCapture[] = [];
  let browser: Browser | undefined;
  // `PROOFSHOT_CHROMIUM_PATH` lets CI images and workstations use a Chromium
  // that is already installed instead of Playwright's own download.
  const executablePath = process.env.PROOFSHOT_CHROMIUM_PATH?.trim() || undefined;
  try {
    browser = await chromium.launch({
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    for (const viewport of viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
        reducedMotion: "reduce",
        colorScheme: "light",
        locale: "en-US",
        timezoneId: "UTC",
      });
      try {
        for (const job of [...options.routes.map(route => ({ route, scene: undefined as SceneSpec | undefined })), ...scenes.map(scene => ({ route: scene.route, scene }))]) {
          const { route, scene } = job;
          const url = `${origin}${normalizeRoute(route) === "/" ? "/" : normalizeRoute(route)}`;
          const sceneContext = scene ? await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor ?? 1, reducedMotion: "reduce", colorScheme: "light", locale: "en-US", timezoneId: "UTC" }) : undefined;
          let capture: PageCapture;
          try { capture = await capturePage(sceneContext ?? context, {
            url,
            route,
            scene,
            viewport: viewport.name,
            side: options.side,
            outDir,
            fullPage: options.fullPage ?? true,
            settleMs: options.settleMs ?? 400,
            timeoutMs: options.timeoutMs ?? 30_000,
            collectA11y: options.collectA11y ?? true,
            axe: options.axe,
            axeCwd: options.axeCwd,
          });
          } finally { await sceneContext?.close(); }
          captures.push(capture);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await server?.close();
  }

  return { captures, origin, servedRoot: server?.root };
}

async function capturePage(
  context: import("playwright").BrowserContext,
  options: {
    url: string;
    route: string;
    scene?: SceneSpec;
    viewport: string;
    side: "base" | "head";
    outDir: string;
    fullPage: boolean;
    settleMs: number;
    timeoutMs: number;
    collectA11y: boolean;
    axe?: boolean;
    axeCwd?: string;
  },
): Promise<PageCapture> {
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  let auditing = false;
  page.on("console", (message) => {
    if (!auditing && message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (!auditing) consoleErrors.push(`Uncaught ${error.message}`);
  });

  const base: PageCapture = {
    route: options.route,
    ...(options.scene ? { scene: options.scene.name } : {}),
    viewport: options.viewport,
    side: options.side,
    url: options.url,
    consoleErrors,
  };

  try {
    const response = await page.goto(options.url, {
      waitUntil: "load",
      timeout: options.timeoutMs,
    });
    if (response && response.status() >= 400) {
      throw new Error(`HTTP ${response.status()} for ${options.url}`);
    }
    await page
      .waitForLoadState("networkidle", { timeout: Math.min(8_000, options.timeoutMs) })
      .catch(() => undefined);
    if (options.settleMs > 0) await page.waitForTimeout(options.settleMs);
    await page.evaluate(async () => {
      const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
      if (fonts?.ready) await fonts.ready;
    }).catch(() => undefined);
    // Scroll through the page once so lazy-loaded images and observers fire.
    await page
      .evaluate(async () => {
        const step = Math.max(300, window.innerHeight);
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 40));
        }
        window.scrollTo(0, 0);
      })
      .catch(() => undefined);
    await page.waitForTimeout(120);

    if (options.scene) {
      const deadline = Date.now() + options.timeoutMs;
      const remaining = () => {
        const ms = deadline - Date.now();
        if (ms <= 0) throw new Error('scene total action timeout exceeded');
        return ms;
      };
      for (const [index, step] of options.scene.steps.entries()) {
        const locator = step.selector ? page.locator(step.selector) : page.getByText(step.text!, { exact: true });
        const timeout = Math.min(step.timeoutMs ?? 5000, remaining());
        try {
          if (step.action === 'click') await locator.click({ timeout });
          else if (step.action === 'fill') await locator.fill(step.value!, { timeout });
          else if (step.action === 'press') await locator.press(step.value!, { timeout });
          else await locator.waitFor({ state: 'visible', timeout });
        } catch (error) { throw new Error(`scene step ${index + 1} (${step.action}): ${(error as Error).message}`); }
      }
      if (options.scene.expect) await page.locator(options.scene.expect).waitFor({ state: 'visible', timeout: Math.min(5000, remaining()) });
      if (options.settleMs > 0) await page.waitForTimeout(Math.min(options.settleMs, remaining()));
    }

    const artifact = options.scene ? `scene-${routeArtifactId(JSON.stringify([options.route, options.scene.name]))}` : routeArtifactId(options.route);
    const fileName = `${options.side}-${artifact}-${options.viewport}.png`;
    const screenshotPath = join(options.outDir, fileName);
    await page.screenshot({
      path: screenshotPath,
      fullPage: options.fullPage,
      animations: "disabled",
      caret: "hide",
    });
    base.screenshotPath = screenshotPath;

    const size = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    base.width = size.width;
    base.height = size.height;

    if (options.collectA11y) {
      base.a11y = await captureA11y(page, consoleErrors);
    }
    if (options.axe) { auditing = true; try { base.axe = await captureAxe(page, options.axeCwd); } finally { auditing = false; } }
  } catch (error) {
    base.error = (error as Error).message;
    if (options.scene) base.blocked = true;
    base.consoleErrors = consoleErrors;
  } finally {
    await page.close().catch(() => undefined);
  }

  return base;
}

/** Parse `desktop,mobile` or `phone=390x844` into viewport specs. */
export function parseViewports(value: string | undefined): ViewportSpec[] | undefined {
  if (!value) return undefined;
  const specs: ViewportSpec[] = [];
  for (const raw of value.split(",")) {
    const token = raw.trim();
    if (token === "") continue;
    const preset = DEFAULT_VIEWPORTS.find((viewport) => viewport.name === token);
    if (preset) {
      specs.push(preset);
      continue;
    }
    const custom = /^([A-Za-z0-9_-]+)=(\d+)x(\d+)$/.exec(token);
    if (custom) {
      specs.push({
        name: custom[1] ?? "custom",
        width: Number(custom[2]),
        height: Number(custom[3]),
      });
      continue;
    }
    throw new Error(
      `proofshot: unknown viewport "${token}" (use desktop, mobile, or name=WIDTHxHEIGHT)`,
    );
  }
  return specs.length > 0 ? specs : undefined;
}
