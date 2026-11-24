import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import type { ViewportSpec } from "./types";
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
  viewports?: ViewportSpec[];
  outDir: string;
  side: "base" | "head";
  fullPage?: boolean;
  settleMs?: number;
  timeoutMs?: number;
  collectA11y?: boolean;
}

export interface PageCapture {
  route: string;
  viewport: string;
  side: "base" | "head";
  url: string;
  width?: number;
  height?: number;
  screenshotPath?: string;
  a11y?: A11ySnapshot;
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
        for (const route of options.routes) {
          const url = `${origin}${normalizeRoute(route) === "/" ? "/" : normalizeRoute(route)}`;
          const capture = await capturePage(context, {
            url,
            route,
            viewport: viewport.name,
            side: options.side,
            outDir,
            fullPage: options.fullPage ?? true,
            settleMs: options.settleMs ?? 400,
            timeoutMs: options.timeoutMs ?? 30_000,
            collectA11y: options.collectA11y ?? true,
          });
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
    viewport: string;
    side: "base" | "head";
    outDir: string;
    fullPage: boolean;
    settleMs: number;
    timeoutMs: number;
    collectA11y: boolean;
  },
): Promise<PageCapture> {
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(`Uncaught ${error.message}`);
  });

  const base: PageCapture = {
    route: options.route,
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

    const fileName = `${options.side}-${routeArtifactId(options.route)}-${options.viewport}.png`;
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
  } catch (error) {
    base.error = (error as Error).message;
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
