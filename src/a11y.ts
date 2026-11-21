import type { Page } from "playwright";

/** Rules this lightweight checker can report. */
export type A11yRule =
  | "img-alt"
  | "button-name"
  | "link-name"
  | "input-label"
  | "heading-order"
  | "duplicate-id"
  | "landmark-main"
  | "html-lang"
  | "page-title"
  | "console-error";

export interface A11yIssue {
  rule: A11yRule;
  /** Short CSS path, e.g. `main > img.hero:nth-of-type(1)`. */
  selector: string;
  detail: string;
}

export interface A11yCounts {
  imagesMissingAlt: number;
  buttonsWithoutName: number;
  linksWithoutName: number;
  inputsWithoutLabel: number;
  headingOrderViolations: number;
  duplicateIds: number;
  /** Number of landmarks found (informational, not an issue count). */
  landmarks: number;
  consoleErrors: number;
}

export interface A11ySnapshot {
  url: string;
  title: string;
  lang: string | null;
  headings: Array<{ level: number; text: string }>;
  counts: A11yCounts;
  issues: A11yIssue[];
}

/** Raw DOM facts gathered inside the page, before console errors are added. */
export interface DomA11yRaw {
  title: string;
  lang: string | null;
  headings: Array<{ level: number; text: string }>;
  counts: Omit<A11yCounts, "consoleErrors">;
  issues: A11yIssue[];
}

export interface A11yMetricDelta {
  key: keyof Omit<A11yCounts, "consoleErrors" | "landmarks">;
  before: number;
  after: number;
  delta: number;
}

export interface A11yDelta {
  before: A11yCounts;
  after: A11yCounts;
  metrics: A11yMetricDelta[];
  /** Issues present after but not before. */
  regressions: A11yIssue[];
  /** Issues present before but not after. */
  fixes: A11yIssue[];
  consoleErrorDelta: number;
  /** True when at least one issue was introduced. */
  regressed: boolean;
  /** after issue count − before issue count. */
  netIssues: number;
}

/**
 * Runs inside the browser (`page.evaluate`). Must stay self-contained: it is
 * serialised and executed in the page, so it may not reference module scope.
 */
export function collectA11yInPage(): DomA11yRaw {
  const issues: A11yIssue[] = [];

  const visible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };

  const escape = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

  const selectorFor = (el: Element): string => {
    const parts: string[] = [];
    let cursor: Element | null = el;
    let depth = 0;
    while (cursor && depth < 3 && cursor.nodeType === 1) {
      const current: Element = cursor;
      let part = current.tagName.toLowerCase();
      const id = current.getAttribute("id");
      if (id) {
        part += `#${escape(id)}`;
        parts.unshift(part);
        break;
      }
      const classes = (current.getAttribute("class") ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2);
      if (classes.length > 0) part += `.${classes.map(escape).join(".")}`;
      const parent: Element | null = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(part);
      cursor = parent;
      depth += 1;
    }
    return parts.join(" > ");
  };

  const accessibleName = (el: Element): string => {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim() !== "") return ariaLabel.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
      if (text !== "") return text;
    }
    const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
    if (text.trim() !== "") return text.trim();
    const title = el.getAttribute("title");
    if (title && title.trim() !== "") return title.trim();
    const image = el.querySelector("img[alt]");
    const alt = image?.getAttribute("alt")?.trim();
    if (alt) return alt;
    const svgTitle = el.querySelector("svg > title");
    if (svgTitle?.textContent?.trim()) return svgTitle.textContent.trim();
    return "";
  };

  const add = (rule: A11yRule, el: Element, detail: string): void => {
    issues.push({ rule, selector: selectorFor(el), detail });
  };

  // --- images -------------------------------------------------------------
  let imagesMissingAlt = 0;
  for (const img of Array.from(document.querySelectorAll("img"))) {
    if (!visible(img)) continue;
    if (img.getAttribute("role") === "presentation" || img.getAttribute("role") === "none") {
      continue;
    }
    if (img.getAttribute("alt") === null && !img.hasAttribute("aria-label")) {
      imagesMissingAlt += 1;
      add("img-alt", img, "image has no alt attribute");
    }
  }
  for (const input of Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="image"]'),
  )) {
    if (!visible(input)) continue;
    if (!input.getAttribute("alt") && !input.getAttribute("aria-label")) {
      imagesMissingAlt += 1;
      add("img-alt", input, "image input has no alt attribute");
    }
  }

  // --- buttons ------------------------------------------------------------
  let buttonsWithoutName = 0;
  const buttonSelectors =
    'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]';
  for (const button of Array.from(document.querySelectorAll(buttonSelectors))) {
    if (!visible(button)) continue;
    const isInput = button.tagName === "INPUT";
    const name = isInput
      ? (button as HTMLInputElement).value?.trim() || accessibleName(button)
      : accessibleName(button);
    if (name === "") {
      buttonsWithoutName += 1;
      add("button-name", button, "button has no accessible name");
    }
  }

  // --- links --------------------------------------------------------------
  let linksWithoutName = 0;
  for (const link of Array.from(document.querySelectorAll("a[href]"))) {
    if (!visible(link)) continue;
    if (accessibleName(link) === "") {
      linksWithoutName += 1;
      add("link-name", link, "link has no accessible name");
    }
  }

  // --- form fields --------------------------------------------------------
  let inputsWithoutLabel = 0;
  const fieldSelector =
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea';
  for (const field of Array.from(document.querySelectorAll(fieldSelector))) {
    if (!visible(field)) continue;
    const id = field.getAttribute("id");
    const wrapped = field.closest("label");
    const labelFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const labelled =
      wrapped !== null ||
      labelFor !== null ||
      (field.getAttribute("aria-label") ?? "").trim() !== "" ||
      (field.getAttribute("aria-labelledby") ?? "").trim() !== "" ||
      (field.getAttribute("title") ?? "").trim() !== "";
    if (!labelled) {
      inputsWithoutLabel += 1;
      add("input-label", field, "form field has no label");
    }
  }

  // --- headings -----------------------------------------------------------
  const headings: Array<{ level: number; text: string }> = [];
  let headingOrderViolations = 0;
  let previousLevel = 0;
  for (const heading of Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    if (!visible(heading)) continue;
    const level = Number(heading.tagName.slice(1));
    const text = (heading.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    headings.push({ level, text });
    if (previousLevel > 0 && level > previousLevel + 1) {
      headingOrderViolations += 1;
      add(
        "heading-order",
        heading,
        `heading jumps from h${previousLevel} to h${level}`,
      );
    }
    previousLevel = level;
  }

  // --- duplicate ids ------------------------------------------------------
  const idCounts = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll("[id]"))) {
    if (!visible(el)) continue;
    const id = el.getAttribute("id");
    if (!id) continue;
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  let duplicateIds = 0;
  for (const [id, count] of idCounts) {
    if (count < 2) continue;
    duplicateIds += count - 1;
    const el = document.getElementById(id);
    if (el) add("duplicate-id", el, `id "${id}" is used ${count} times`);
  }

  // --- landmarks ----------------------------------------------------------
  const landmarkSelector =
    'main, nav, header, footer, aside, [role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
  const landmarks = Array.from(document.querySelectorAll(landmarkSelector)).filter(visible).length;
  const mainLandmarks = Array.from(
    document.querySelectorAll('main, [role="main"]'),
  ).filter(visible).length;
  if (mainLandmarks === 0) {
    issues.push({
      rule: "landmark-main",
      selector: "body",
      detail: "page has no main landmark",
    });
  }

  // --- document -----------------------------------------------------------
  const lang = document.documentElement.getAttribute("lang");
  if (!lang || lang.trim() === "") {
    issues.push({
      rule: "html-lang",
      selector: "html",
      detail: "html element has no lang attribute",
    });
  }
  const title = (document.title ?? "").trim();
  if (title === "") {
    issues.push({
      rule: "page-title",
      selector: "head > title",
      detail: "document has no title",
    });
  }

  return {
    title,
    lang: lang ? lang.trim() : null,
    headings,
    counts: {
      imagesMissingAlt,
      buttonsWithoutName,
      linksWithoutName,
      inputsWithoutLabel,
      headingOrderViolations,
      duplicateIds,
      landmarks,
    },
    issues,
  };
}

/** Collect a snapshot for the currently loaded page. */
export async function captureA11y(
  page: Page,
  consoleErrors: string[],
): Promise<A11ySnapshot> {
  const raw = (await page.evaluate(collectA11yInPage)) as DomA11yRaw;
  const issues: A11yIssue[] = [...raw.issues];
  for (const message of uniqueMessages(consoleErrors)) {
    issues.push({
      rule: "console-error",
      selector: "console",
      detail: truncate(message, 160),
    });
  }
  return {
    url: page.url(),
    title: raw.title,
    lang: raw.lang,
    headings: raw.headings,
    counts: {
      ...raw.counts,
      consoleErrors: uniqueMessages(consoleErrors).length,
    },
    issues,
  };
}

function uniqueMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const message of messages) {
    const key = truncate(message.trim(), 160);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const COUNTED_METRICS: Array<keyof Omit<A11yCounts, "consoleErrors" | "landmarks">> = [
  "imagesMissingAlt",
  "buttonsWithoutName",
  "linksWithoutName",
  "inputsWithoutLabel",
  "headingOrderViolations",
  "duplicateIds",
];

export function issueKey(issue: A11yIssue): string {
  return `${issue.rule}|${issue.selector}|${issue.detail}`;
}

/** Compare two snapshots and say exactly what got worse, better, or moved. */
export function computeA11yDelta(
  before: A11ySnapshot,
  after: A11ySnapshot,
): A11yDelta {
  const beforeKeys = new Set(before.issues.map(issueKey));
  const afterKeys = new Set(after.issues.map(issueKey));

  const regressions = after.issues.filter((issue) => !beforeKeys.has(issueKey(issue)));
  const fixes = before.issues.filter((issue) => !afterKeys.has(issueKey(issue)));

  const metrics: A11yMetricDelta[] = COUNTED_METRICS.map((key) => ({
    key,
    before: before.counts[key],
    after: after.counts[key],
    delta: after.counts[key] - before.counts[key],
  }));

  const beforeIssueCount = before.issues.length;
  const afterIssueCount = after.issues.length;

  return {
    before: before.counts,
    after: after.counts,
    metrics,
    regressions,
    fixes,
    consoleErrorDelta: after.counts.consoleErrors - before.counts.consoleErrors,
    regressed: regressions.length > 0 || after.counts.consoleErrors > before.counts.consoleErrors,
    netIssues: afterIssueCount - beforeIssueCount,
  };
}

/** Compact table cell: `✅ 0`, `⚠️ +2`, `🎉 −1`. */
export function summarizeA11y(delta: A11yDelta | null | undefined): string {
  if (!delta) return "—";
  const net = delta.regressions.length - delta.fixes.length;
  if (net === 0) return "✅ 0";
  if (net > 0) return `⚠️ +${net}`;
  return `🎉 −${Math.abs(net)}`;
}

export function describeA11yCounts(counts: A11yCounts): string {
  const parts = [
    `images ${counts.imagesMissingAlt}`,
    `buttons ${counts.buttonsWithoutName}`,
    `links ${counts.linksWithoutName}`,
    `fields ${counts.inputsWithoutLabel}`,
    `headings ${counts.headingOrderViolations}`,
    `console ${counts.consoleErrors}`,
  ];
  return parts.join(" · ");
}
