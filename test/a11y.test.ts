import { describe, expect, it } from "vitest";
import {
  computeA11yDelta,
  describeA11yCounts,
  summarizeA11y,
  type A11ySnapshot,
} from "../src/a11y";

function snapshot(overrides: Partial<A11ySnapshot> = {}): A11ySnapshot {
  return {
    url: "http://localhost/",
    title: "Example",
    lang: "en",
    headings: [{ level: 1, text: "Title" }],
    counts: {
      imagesMissingAlt: 0,
      buttonsWithoutName: 0,
      linksWithoutName: 0,
      inputsWithoutLabel: 0,
      headingOrderViolations: 0,
      duplicateIds: 0,
      landmarks: 2,
      consoleErrors: 0,
    },
    issues: [],
    ...overrides,
  };
}

describe("computeA11yDelta", () => {
  it("sees no change between identical snapshots", () => {
    const before = snapshot();
    const delta = computeA11yDelta(before, before);
    expect(delta.regressed).toBe(false);
    expect(delta.regressions).toEqual([]);
    expect(delta.fixes).toEqual([]);
    expect(delta.netIssues).toBe(0);
    expect(summarizeA11y(delta)).toBe("✅ 0");
  });

  it("flags an image that lost its alt text", () => {
    const before = snapshot();
    const after = snapshot({
      counts: { ...before.counts, imagesMissingAlt: 1 },
      issues: [
        { rule: "img-alt", selector: "main > img.hero", detail: "image has no alt attribute" },
      ],
    });
    const delta = computeA11yDelta(before, after);
    expect(delta.regressed).toBe(true);
    expect(delta.regressions).toHaveLength(1);
    expect(delta.regressions[0]?.rule).toBe("img-alt");
    expect(delta.netIssues).toBe(1);
    expect(summarizeA11y(delta)).toBe("⚠️ +1");

    const metric = delta.metrics.find((entry) => entry.key === "imagesMissingAlt");
    expect(metric).toEqual({ key: "imagesMissingAlt", before: 0, after: 1, delta: 1 });
  });

  it("counts a fixed issue as an improvement", () => {
    const issue = {
      rule: "button-name" as const,
      selector: "main > button.icon",
      detail: "button has no accessible name",
    };
    const before = snapshot({
      counts: {
        imagesMissingAlt: 0,
        buttonsWithoutName: 1,
        linksWithoutName: 0,
        inputsWithoutLabel: 0,
        headingOrderViolations: 0,
        duplicateIds: 0,
        landmarks: 2,
        consoleErrors: 0,
      },
      issues: [issue],
    });
    const after = snapshot();
    const delta = computeA11yDelta(before, after);
    expect(delta.regressed).toBe(false);
    expect(delta.fixes).toHaveLength(1);
    expect(delta.netIssues).toBe(-1);
    expect(summarizeA11y(delta)).toBe("🎉 −1");
  });

  it("treats new console errors as regressions", () => {
    const before = snapshot();
    const after = snapshot({
      counts: { ...before.counts, consoleErrors: 1 },
      issues: [
        { rule: "console-error", selector: "console", detail: "GET /api 500" },
      ],
    });
    const delta = computeA11yDelta(before, after);
    expect(delta.regressed).toBe(true);
    expect(delta.consoleErrorDelta).toBe(1);
    expect(delta.regressions[0]?.detail).toBe("GET /api 500");
  });

  it("nets several regressions and fixes into one number", () => {
    const before = snapshot({
      issues: [
        { rule: "link-name", selector: "nav > a", detail: "link has no accessible name" },
      ],
      counts: { ...snapshot().counts, linksWithoutName: 1 },
    });
    const after = snapshot({
      issues: [
        { rule: "heading-order", selector: "main > h3", detail: "heading jumps from h1 to h3" },
        { rule: "img-alt", selector: "main > img", detail: "image has no alt attribute" },
        { rule: "duplicate-id", selector: "#nav", detail: 'id "nav" is used 2 times' },
      ],
      counts: {
        ...snapshot().counts,
        headingOrderViolations: 1,
        imagesMissingAlt: 1,
        duplicateIds: 1,
      },
    });
    const delta = computeA11yDelta(before, after);
    expect(delta.regressions).toHaveLength(3);
    expect(delta.fixes).toHaveLength(1);
    expect(summarizeA11y(delta)).toBe("⚠️ +2");
  });

  it("describes counts for the report", () => {
    expect(describeA11yCounts(snapshot().counts)).toBe(
      "images 0 · buttons 0 · links 0 · fields 0 · headings 0 · console 0",
    );
  });

  it("has a placeholder when no delta exists", () => {
    expect(summarizeA11y(null)).toBe("—");
  });
});
