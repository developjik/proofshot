import { describe, expect, it } from "vitest";
import { computeStats, REPORT_MARKER, buildReportMarkdown } from "../src/report";
import type { ComparisonResult } from "../src/report";
import type { A11yDelta } from "../src/a11y";
import type { ProofshotMeta } from "../src/types";

const meta: ProofshotMeta = {
  baseLabel: "origin/main@abc1234",
  headLabel: "HEAD@def5678",
  baseSource: "demo/before",
  headSource: "demo/after",
  routes: ["/", "/pricing"],
  routesSource: "git diff origin/main...HEAD (2 files)",
  viewports: ["desktop", "mobile"],
  thresholdPercent: 0.1,
  generatedAt: "2026-11-21T14:00:00.000Z",
  notes: [],
};

function delta(regressions: number, fixes = 0): A11yDelta {
  return {
    before: {
      imagesMissingAlt: 0,
      buttonsWithoutName: 0,
      linksWithoutName: 0,
      inputsWithoutLabel: 0,
      headingOrderViolations: 0,
      duplicateIds: 0,
      landmarks: 1,
      consoleErrors: 0,
    },
    after: {
      imagesMissingAlt: regressions,
      buttonsWithoutName: 0,
      linksWithoutName: 0,
      inputsWithoutLabel: 0,
      headingOrderViolations: 0,
      duplicateIds: 0,
      landmarks: 1,
      consoleErrors: 0,
    },
    metrics: [],
    regressions: Array.from({ length: regressions }, (_, index) => ({
      rule: "img-alt" as const,
      selector: `main > img:nth-of-type(${index + 1})`,
      detail: "image has no alt attribute",
    })),
    fixes: Array.from({ length: fixes }, (_, index) => ({
      rule: "link-name" as const,
      selector: `nav > a:nth-of-type(${index + 1})`,
      detail: "link has no accessible name",
    })),
    consoleErrorDelta: 0,
    regressed: regressions > 0,
    netIssues: regressions - fixes,
  };
}

const results: ComparisonResult[] = [
  {
    route: "/",
    viewport: "desktop",
    status: "changed",
    diffPercent: 3.42,
    diffPixels: 1000,
    width: 1280,
    height: 900,
    sizeMismatch: false,
    images: {
      before: "base-root-desktop.png",
      after: "head-root-desktop.png",
      diff: "root-desktop-diff.png",
    },
    a11y: delta(2),
    consoleErrors: { before: 0, after: 1 },
  },
  {
    route: "/",
    viewport: "mobile",
    status: "unchanged",
    diffPercent: 0,
    diffPixels: 0,
    width: 390,
    height: 1200,
    sizeMismatch: false,
    images: { before: "base-root-mobile.png", after: "head-root-mobile.png" },
    a11y: delta(0),
    consoleErrors: { before: 0, after: 0 },
  },
  {
    route: "/pricing",
    viewport: "desktop",
    status: "error",
    diffPercent: null,
    diffPixels: 0,
    width: null,
    height: null,
    sizeMismatch: false,
    images: { before: "base-pricing-desktop.png" },
    a11y: null,
    consoleErrors: { before: 0, after: 0 },
    error: "HTTP 500 for http://127.0.0.1:1234/pricing",
  },
];

describe("buildReportMarkdown", () => {
  it("starts with the marker used to update the same PR comment", () => {
    expect(buildReportMarkdown(meta, results).startsWith(REPORT_MARKER)).toBe(true);
  });

  it("summarises changed, unchanged and failed rows", () => {
    const markdown = buildReportMarkdown(meta, results);
    expect(markdown).toContain("**1 changed · 1 unchanged · 1 failed**");
    expect(markdown).toContain("2 route(s) × 2 viewport(s)");
    expect(markdown).toContain("| `/` | desktop | **3.42%** | ⚠️ +2 | 0 → 1 | 🔴 changed |");
    expect(markdown).toContain("| `/pricing` | desktop | — | — | 0 | ⚠️ failed |");
  });

  it("lists new a11y issues and links the evidence images", () => {
    const markdown = buildReportMarkdown(meta, results);
    expect(markdown).toContain("![after](head-root-desktop.png)");
    expect(markdown).toContain("![diff](root-desktop-diff.png)");
    expect(markdown).toContain("**New issues**");
    expect(markdown).toContain("`img-alt`");
    expect(markdown).toContain("HTTP 500");
  });

  it("does not draw an empty diff cell as an image", () => {
    const markdown = buildReportMarkdown(meta, results);
    const unchangedRow = markdown
      .split("\n")
      .find((line) => line.startsWith("| `/` | mobile |"));
    expect(unchangedRow).toBeDefined();
    expect(unchangedRow).toContain("| 🟢 unchanged |");
  });

  it("computes stats", () => {
    const stats = computeStats(results);
    expect(stats).toEqual({
      total: 3,
      changed: 1,
      unchanged: 1,
      errors: 1,
      a11yRegressions: 1,
      worstPercent: 3.42,
    });
  });

  it("handles an empty result set", () => {
    expect(buildReportMarkdown(meta, [])).toContain("_No screens changed");
  });
});

it('bounds a large PR report and keeps full structured details separate',()=>{
 const result={route:'/',viewport:'desktop',status:'unchanged' as const,diffPercent:0,consoleErrors:{before:0,after:0}} as ComparisonResult;
 const markdown=buildReportMarkdown({...meta,notes:['detail'.repeat(20000)]},[result]);expect(markdown.length).toBeLessThan(65536);expect(markdown).toContain('Full issue details are in report.json');
});
