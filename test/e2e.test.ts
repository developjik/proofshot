import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCompare } from "../src/compare";
import { REPORT_MARKER } from "../src/report";

/**
 * Real Playwright run against the demo fixtures: a changed home page and an
 * untouched pricing page. This is the end-to-end proof that capture, pixel
 * diff, a11y delta, report generation and the exit contract all work together.
 */
const root = resolve(process.cwd());

describe("end-to-end compare (demo/before vs demo/after)", () => {
  let outDir = "";

  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it(
    "captures both sides, diffs pixels, reports a11y regressions and writes the report",
    async () => {
      outDir = await mkdtemp(join(tmpdir(), "proofshot-e2e-"));
      const outcome = await runCompare({
        cwd: root,
        base: "demo/before",
        head: "demo/after",
        routes: ["/", "/pricing"],
        outDir,
        viewports: [
          { name: "desktop", width: 1280, height: 800 },
          { name: "mobile", width: 390, height: 844 },
        ],
        log: () => undefined,
      });

      expect(outcome.stats.errors).toBe(0);
      expect(outcome.results).toHaveLength(4);

      const homeDesktop = outcome.results.find(
        (result) => result.route === "/" && result.viewport === "desktop",
      );
      expect(homeDesktop?.status).toBe("changed");
      expect(homeDesktop?.diffPercent ?? 0).toBeGreaterThan(1);
      expect(homeDesktop?.images.before).toBeTruthy();
      expect(homeDesktop?.images.after).toBeTruthy();
      expect(homeDesktop?.images.diff).toBeTruthy();

      const pricingDesktop = outcome.results.find(
        (result) => result.route === "/pricing" && result.viewport === "desktop",
      );
      expect(pricingDesktop?.status).toBe("unchanged");
      expect(pricingDesktop?.diffPercent).toBe(0);

      const homeRules = new Set(
        (homeDesktop?.a11y?.regressions ?? []).map((issue) => issue.rule),
      );
      expect(homeRules.has("img-alt")).toBe(true);
      expect(homeRules.has("button-name")).toBe(true);
      expect(homeRules.has("heading-order")).toBe(true);
      expect(homeRules.has("console-error")).toBe(true);
      expect(homeDesktop?.a11y?.regressed).toBe(true);
      expect(homeDesktop?.consoleErrors).toEqual({ before: 0, after: 1 });

      expect(pricingDesktop?.a11y?.regressions ?? []).toHaveLength(0);

      // Every produced image is a real file on disk.
      for (const name of [
        homeDesktop?.images.before,
        homeDesktop?.images.after,
        homeDesktop?.images.diff,
        pricingDesktop?.images.before,
      ]) {
        if (!name) continue;
        const info = await stat(join(outDir, name));
        expect(info.size).toBeGreaterThan(100);
      }

      const report = await readFile(outcome.reportPath, "utf8");
      expect(report.startsWith(REPORT_MARKER)).toBe(true);
      expect(report).toContain("| `/` | desktop | **");
      expect(report).toContain("`/pricing`");
      expect(report).toContain("New issues");
      expect(report).toContain("img-alt");

      const json = JSON.parse(await readFile(outcome.jsonPath, "utf8")) as {
        stats: { total: number; changed: number };
      };
      expect(json.stats.total).toBe(4);
      expect(json.stats.changed).toBeGreaterThanOrEqual(1);
    },
    180_000,
  );

  it(
    "exits non-zero when --fail-on is triggered",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "proofshot-e2e-fail-"));
      try {
        const outcome = await runCompare({
          cwd: root,
          base: "demo/before",
          head: "demo/after",
          routes: ["/"],
          outDir: dir,
          viewports: [{ name: "desktop", width: 1280, height: 800 }],
          failOn: ["change", "a11y"],
          log: () => undefined,
        });
        expect(outcome.exitCode).toBe(1);
        expect(outcome.failures.length).toBeGreaterThan(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
