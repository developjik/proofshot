import type { AxeDelta } from './axe';
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { A11yDelta, A11yIssue } from "./a11y";
import { describeA11yCounts, summarizeA11y } from "./a11y";
import type { ProofshotMeta } from "./types";
import { formatPercent } from "./util";

export type ComparisonStatus = "changed" | "unchanged" | "error";

export interface ComparisonResult {
  route: string;
  viewport: string;
  status: ComparisonStatus;
  /** 0–100; null when a side failed to capture. */
  diffPercent: number | null;
  diffPixels: number;
  width: number | null;
  height: number | null;
  sizeMismatch: boolean;
  /** Raw screenshot sizes before padding. */
  sizes?: { before: { width: number; height: number }; after: { width: number; height: number } };
  images: { before?: string; after?: string; diff?: string };
  a11y?: A11yDelta | null;
  axe?: AxeDelta;
  consoleErrors: { before: number; after: number };
  error?: string;
}

export const REPORT_MARKER = "<!-- proofshot:report -->";

export interface ReportStats {
  total: number;
  changed: number;
  unchanged: number;
  errors: number;
  a11yRegressions: number;
  worstPercent: number;
}

export function computeStats(results: ComparisonResult[]): ReportStats {
  let changed = 0;
  let unchanged = 0;
  let errors = 0;
  let a11yRegressions = 0;
  let worstPercent = 0;
  for (const result of results) {
    if (result.status === "changed") changed += 1;
    else if (result.status === "unchanged") unchanged += 1;
    else errors += 1;
    if (result.a11y?.regressed || result.axe?.regressed) a11yRegressions += 1;
    if (result.diffPercent !== null && result.diffPercent > worstPercent) {
      worstPercent = result.diffPercent;
    }
  }
  return { total: results.length, changed, unchanged, errors, a11yRegressions, worstPercent };
}

/**
 * Render the PR comment / `report.md` body. Stable enough to be posted as-is:
 * `gh pr comment --body-file report.md --edit-last --create-if-none`.
 */
export function buildReportMarkdown(
  meta: ProofshotMeta,
  results: ComparisonResult[],
): string {
  const stats = computeStats(results);
  const lines: string[] = [];

  lines.push(REPORT_MARKER);
  lines.push("## 📸 proofshot");
  lines.push("");
  lines.push(
    `**${stats.changed} changed · ${stats.unchanged} unchanged · ${stats.errors} failed**` +
      (stats.a11yRegressions > 0 ? ` · **${stats.a11yRegressions} a11y regressions**` : "") +
      ` — \`${meta.baseLabel}\` → \`${meta.headLabel}\``,
  );
  lines.push("");
  lines.push(
    `${meta.routes.length} route(s) × ${meta.viewports.length} viewport(s) · threshold ${formatPercent(
      meta.thresholdPercent,
    )} · routes from ${meta.routesSource}`,
  );
  lines.push("");

  if (stats.total === 0) {
    lines.push("_No screens changed and no captures were produced._");
    return `${lines.join("\n")}\n`;
  }

  lines.push("| Route | Viewport | Pixel diff | a11y | Console | Status |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const result of [...results].sort(sortResults)) {
    const diff =
      result.diffPercent === null ? "—" : `**${formatPercent(result.diffPercent)}**`;
    const consoleCell =
      result.consoleErrors.before === result.consoleErrors.after
        ? `${result.consoleErrors.after}`
        : `${result.consoleErrors.before} → ${result.consoleErrors.after}`;
    lines.push(
      `| \`${result.route}\` | ${result.viewport} | ${
        result.status === "error" ? "—" : diff
      } | ${summarizeA11y(result.a11y)} | ${consoleCell} | ${statusLabel(result.status)} |`,
    );
  }
  lines.push("");

  const detailed = results.filter(
    (result) =>
      result.status === "error" ||
      result.status === "changed" ||
      (result.a11y?.regressions.length ?? 0) > 0,
  );

  if (detailed.length > 0) {
    lines.push("<details>");
    lines.push("<summary>Evidence — before / after / diff, and what got worse</summary>");
    lines.push("");
    for (const result of [...detailed].sort(sortResults)) {
      lines.push(
        `### \`${result.route}\` · ${result.viewport} — ${
          result.diffPercent === null ? "capture failed" : `${formatPercent(result.diffPercent)} changed`
        }`,
      );
      lines.push("");
      if (result.error) {
        lines.push(`> ⚠️ ${result.error}`);
        lines.push("");
      }
      if (result.images.before || result.images.after || result.images.diff) {
        lines.push("| Before | After | Diff |");
        lines.push("| --- | --- | --- |");
        lines.push(
          `| ${imageCell(result.images.before, "before")} | ${imageCell(result.images.after, "after")} | ${imageCell(
            result.images.diff, "diff",
          )} |`,
        );
        lines.push("");
      }
      if (result.sizeMismatch) {
        const sizes = result.sizes;
        const detail = sizes
          ? `before ${sizes.before.width}×${sizes.before.height} → after ${sizes.after.width}×${sizes.after.height}`
          : `${result.width ?? "?"}×${result.height ?? "?"}`;
        lines.push(
          `_Screenshot size changed (${detail}); the shorter capture is padded with the page background for the diff._`,
        );
        lines.push("");
      }
      if (result.a11y) {
        lines.push(`a11y counts — ${describeA11yCounts(result.a11y.before)}`);
        lines.push(`→ ${describeA11yCounts(result.a11y.after)}`);
        lines.push("");
        if (result.a11y.regressions.length > 0) {
          lines.push("**New issues**");
          lines.push("");
          for (const issue of result.a11y.regressions.slice(0, 8)) {
            lines.push(formatIssue(issue));
          }
          if (result.a11y.regressions.length > 8) {
            lines.push(`- …and ${result.a11y.regressions.length - 8} more`);
          }
          lines.push("");
        }
        if (result.a11y.fixes.length > 0) {
          lines.push(`**Fixed** — ${result.a11y.fixes.length} issue(s), e.g. ${formatIssue(
            result.a11y.fixes[0] as A11yIssue,
          ).replace(/^- /, "")}`);
          lines.push("");
        }
      }
    }
    lines.push("</details>");
    lines.push("");
  }

  const axeResults = results.filter(result => result.axe);
  if (axeResults.length) {
    lines.push('## axe accessibility delta', '');
    for (const result of axeResults) {
      const axe = result.axe!;
      lines.push(`### ${result.route} (${result.viewport})`, '');
      if (axe.before.status !== 'ok' || axe.after.status !== 'ok') {
        lines.push(`Skipped: base ${axe.before.reason ?? axe.before.status}; head ${axe.after.reason ?? axe.after.status}`, '');
        continue;
      }
      lines.push(`New: ${axe.regressions.length}; Existing: ${axe.existing.length}; Fixed: ${axe.after.partial ? 'unavailable (partial head audit)' : axe.fixes.length}; Needs manual review: ${axe.after.incomplete ?? 0}`, '');
      if (axe.before.partial) lines.push(`Baseline partial: ${axe.before.reason}`, '');
      if (axe.after.partial) lines.push(`Partial: ${axe.after.reason}`, '');
      for (const [label, issues] of [['New', axe.regressions], ['Existing', axe.existing], ['Fixed', axe.fixes], ['Unclassified (baseline not audited)', axe.unclassified ?? []]] as const) {
        for (const issue of issues.slice(0, 20)) lines.push(`- ${label}: ${issue.rule} (${issue.impact ?? 'unknown'}) at ${JSON.stringify(issue.target).slice(0, 200)}`);
        if (issues.length > 20) lines.push(`- ${issues.length - 20} more ${label.toLowerCase()} issues in report.json`);
      }
      lines.push('');
    }
  }
  if (meta.notes.length > 0) {
    lines.push("> " + meta.notes.join("\n> "));
    lines.push("");
  }

  lines.push(
    `<sub>Generated ${meta.generatedAt} by [proofshot](https://github.com/developjik/proofshot) · base source \`${meta.baseSource}\` · head source \`${meta.headSource}\`</sub>`,
  );

  const markdown = `${lines.join("\n")}\n`;
  if (!axeResults.length || markdown.length <= 60000) return markdown;
  const cutoff = markdown.lastIndexOf("\n", 59000);
  return markdown.slice(0, cutoff) + "\n\nReport shortened for PR comment limits. Full issue details are in report.json.\n";
}

function imageCell(file: string | undefined, label: string): string {
  return file ? `![${label}](${file})` : "—";
}

function statusLabel(status: ComparisonStatus): string {
  if (status === "changed") return "🔴 changed";
  if (status === "unchanged") return "🟢 unchanged";
  return "⚠️ failed";
}

function formatIssue(issue: A11yIssue): string {
  return `- \`${issue.rule}\` \`${issue.selector}\` — ${issue.detail}`;
}

function sortResults(a: ComparisonResult, b: ComparisonResult): number {
  const av = a.diffPercent ?? -1;
  const bv = b.diffPercent ?? -1;
  if (bv !== av) return bv - av;
  return `${a.route}${a.viewport}`.localeCompare(`${b.route}${b.viewport}`);
}

export function buildReportJson(meta: ProofshotMeta, results: ComparisonResult[]): string {
  return `${JSON.stringify({ meta, stats: computeStats(results), results }, null, 2)}\n`;
}

export async function writeReport(
  outDir: string,
  meta: ProofshotMeta,
  results: ComparisonResult[],
): Promise<{ markdownPath: string; jsonPath: string }> {
  const markdownPath = `${outDir}/report.md`;
  const jsonPath = `${outDir}/report.json`;
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, buildReportMarkdown(meta, results), "utf8");
  await writeFile(jsonPath, buildReportJson(meta, results), "utf8");
  return { markdownPath, jsonPath };
}
