import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from 'playwright';
export interface AxeIssue { rule: string; impact: string | null; target: Array<string | string[]>; detail: string }
export interface AxeSnapshot { status: 'ok' | 'skipped'; reason?: string; issues: AxeIssue[]; incomplete?: number }
export interface AxeDelta { before: AxeSnapshot; after: AxeSnapshot; regressions: AxeIssue[]; existing: AxeIssue[]; fixes: AxeIssue[]; regressed: boolean }
/** Optional, lazy resolution from the invoking project's dependencies. No network fetch. */
export async function captureAxe(page: Page, cwd = process.cwd()): Promise<AxeSnapshot> {
  let source: string;
  try {
    const require = createRequire(join(cwd, 'package.json'));
    source = require.resolve('axe-core/axe.min.js');
  } catch { return { status: 'skipped', reason: 'axe-core is not installed in the project', issues: [] }; }
  try {
    await page.addScriptTag({ path: source });
    const result = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (options: unknown) => Promise<{ violations: Array<{id: string; impact: string | null; nodes: Array<{target: Array<string | string[]>; failureSummary?: string}>}>; incomplete: unknown[] }> } }).axe;
      return axe.run({ resultTypes: ['violations', 'incomplete'], preload: false });
    });
    return { status: 'ok', incomplete: result.incomplete.length, issues: result.violations.flatMap(rule => rule.nodes.map(node => ({ rule: rule.id, impact: rule.impact, target: node.target, detail: node.failureSummary ?? rule.id }))) };
  } catch (error) { return { status: 'skipped', reason: `axe unsupported or unavailable: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, issues: [] }; }
}
const key = (issue: AxeIssue) => JSON.stringify([issue.rule, issue.target]);
export function computeAxeDelta(before: AxeSnapshot, after: AxeSnapshot): AxeDelta {
  if (before.status !== 'ok' || after.status !== 'ok') return { before, after, regressions: [], existing: [], fixes: [], regressed: false };
  const old = new Set(before.issues.map(key)); const current = new Set(after.issues.map(key));
  const regressions = after.issues.filter(issue => !old.has(key(issue)));
  return { before, after, regressions, existing: after.issues.filter(issue => old.has(key(issue))), fixes: before.issues.filter(issue => !current.has(key(issue))), regressed: regressions.length > 0 };
}
