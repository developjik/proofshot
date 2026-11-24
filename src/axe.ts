import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from 'playwright';
export interface AxeIssue { rule: string; impact: string | null; target: Array<string | string[]>; detail: string }
export interface AxeSnapshot { status: 'ok' | 'skipped'; reason?: string; issues: AxeIssue[]; incomplete?: number; uncertain?: AxeIssue[]; partial?: boolean }
export interface AxeDelta { before: AxeSnapshot; after: AxeSnapshot; regressions: AxeIssue[]; existing: AxeIssue[]; fixes: AxeIssue[]; regressed: boolean }
/** Optional, lazy resolution from the invoking project's dependencies. No network fetch. */
export async function captureAxe(page: Page, cwd = process.cwd()): Promise<AxeSnapshot> {
  let source: string;
  try {
    const require = createRequire(join(cwd, 'package.json'));
    source = require.resolve('axe-core/axe.min.js');
  } catch { return { status: 'skipped', reason: 'axe-core is not installed in the project', issues: [] }; }
  const snapshot: AxeSnapshot = {status:'ok', issues:[], uncertain:[], incomplete:0};
  for (const frame of page.frames()) {
    try {
      await frame.addScriptTag({path:source});
      const result = await frame.evaluate(async () => {
        const axe=(window as unknown as {axe:{run:(options:unknown)=>Promise<{violations:Array<{id:string;impact:string|null;nodes:Array<{target:Array<string|string[]>;failureSummary?:string}>}>;incomplete:Array<{id:string;impact:string|null;nodes:Array<{target:Array<string|string[]>;failureSummary?:string}>}>}>}}).axe;
        return axe.run({resultTypes:['violations','incomplete'],preload:false,iframes:false});
      });
      const prefix:string[]=[];let cursor=frame;
      while(cursor.parentFrame()) {
        const element=await cursor.frameElement();
        prefix.unshift(await element.evaluate(node=>{const el=node as Element;if(el.id)return '#'+CSS.escape(el.id);const tag=el.tagName.toLowerCase();const siblings=Array.from(el.parentElement?.children??[]).filter(x=>x.tagName===el.tagName);return tag+':nth-of-type('+(siblings.indexOf(el)+1)+')';}));
        await element.dispose();cursor=cursor.parentFrame()!;
      }
      const issues=(rules:typeof result.violations)=>rules.flatMap(rule=>rule.nodes.map(node=>({rule:rule.id,impact:rule.impact,target:[...prefix,...node.target],detail:node.failureSummary??rule.id})));
      snapshot.issues.push(...issues(result.violations));snapshot.uncertain!.push(...issues(result.incomplete));snapshot.incomplete!+=result.incomplete.length;
    } catch(error) {
      if(frame===page.mainFrame())return {status:'skipped',reason:`axe unsupported or unavailable: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`,issues:[]};
      snapshot.partial=true;snapshot.reason='One or more frames could not be audited; fixes are not inferred';
    }
  }
  return snapshot;
}
const key = (issue: AxeIssue) => JSON.stringify([issue.rule, issue.target]);
export function computeAxeDelta(before: AxeSnapshot, after: AxeSnapshot): AxeDelta {
  if (before.status !== 'ok' || after.status !== 'ok') return { before, after, regressions: [], existing: [], fixes: [], regressed: false };
  const old = new Set(before.issues.map(key)); const current = new Set([...after.issues, ...(after.uncertain ?? [])].map(key));
  const regressions = after.issues.filter(issue => !old.has(key(issue)));
  return { before, after, regressions, existing: after.issues.filter(issue => old.has(key(issue))), fixes: after.partial ? [] : before.issues.filter(issue => !current.has(key(issue))), regressed: regressions.length > 0 };
}
