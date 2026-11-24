import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from 'playwright';
export interface AxeIssue { rule: string; impact: string | null; target: Array<string | string[]>; detail: string }
export interface AxeSnapshot { status: 'ok' | 'skipped'; reason?: string; issues: AxeIssue[]; incomplete?: number; uncertain?: AxeIssue[]; partial?: boolean; unauditedFrames?: string[][] }
export interface AxeDelta { before: AxeSnapshot; after: AxeSnapshot; regressions: AxeIssue[]; existing: AxeIssue[]; fixes: AxeIssue[]; unclassified?: AxeIssue[]; regressed: boolean }
/** Optional, lazy resolution from the invoking project's dependencies. No network fetch. */
export async function captureAxe(page: Page, cwd = process.cwd()): Promise<AxeSnapshot> {
  let source: string;
  try {
    const require = createRequire(join(cwd, 'package.json'));
    source = require.resolve('axe-core/axe.min.js');
  } catch { return { status: 'skipped', reason: 'axe-core is not installed in the project', issues: [] }; }
  const snapshot: AxeSnapshot = {status:'ok', issues:[], uncertain:[], incomplete:0};
  for (const frame of page.frames()) {
    const prefix:string[]=[];let cursor=frame;
    try {
      while(cursor.parentFrame()) {
        const element=await cursor.frameElement();
        prefix.unshift(await element.evaluate(node=>{let el=node as Element|null;const parts:string[]=[];while(el){if(el.id){parts.unshift('#'+CSS.escape(el.id));break;}const tag=el.tagName.toLowerCase();const siblings=Array.from(el.parentElement?.children??[]).filter(x=>x.tagName===el!.tagName);parts.unshift(tag+':nth-of-type('+(siblings.indexOf(el)+1)+')');el=el.parentElement;}return parts.join(' > ');}));
        await element.dispose();cursor=cursor.parentFrame()!;
      }
      await frame.addScriptTag({path:source});
      const result = await frame.evaluate(async (isTop) => {
        const axe=(window as unknown as {axe:{run:(options:unknown)=>Promise<{violations:Array<{id:string;impact:string|null;nodes:Array<{target:Array<string|string[]>;failureSummary?:string}>}>;incomplete:Array<{id:string;impact:string|null;nodes:Array<{target:Array<string|string[]>;failureSummary?:string}>}>}>}}).axe;
        return axe.run({resultTypes:['violations','incomplete'],preload:false,iframes:false,...(!isTop?{rules:{'document-title':{enabled:false},'landmark-one-main':{enabled:false},'page-has-heading-one':{enabled:false}}}:{})});
      },frame===page.mainFrame());
      const issues=(rules:typeof result.violations)=>rules.flatMap(rule=>rule.nodes.map(node=>({rule:rule.id,impact:rule.impact,target:[...prefix,...node.target],detail:node.failureSummary??rule.id})));
      snapshot.issues.push(...issues(result.violations));snapshot.uncertain!.push(...issues(result.incomplete));snapshot.incomplete!+=result.incomplete.length;
    } catch(error) {
      if(frame===page.mainFrame())return {status:'skipped',reason:`axe unsupported or unavailable: ${error instanceof Error?error.message.split('\n')[0]:String(error)}`,issues:[]};
      (snapshot.unauditedFrames??=[]).push(prefix);snapshot.partial=true;snapshot.reason='One or more frames could not be audited; fixes are not inferred';
    }
  }
  return snapshot;
}
const key = (issue: AxeIssue) => JSON.stringify([issue.rule, issue.target]);
export function computeAxeDelta(before: AxeSnapshot, after: AxeSnapshot): AxeDelta {
  if (before.status !== 'ok' || after.status !== 'ok') return { before, after, regressions: [], existing: [], fixes: [], regressed: false };
  const old = new Set(before.issues.map(key)); const current = new Set([...after.issues, ...(after.uncertain ?? [])].map(key));
  const unknownBefore = (issue:AxeIssue) => before.unauditedFrames?.some(prefix=>prefix.length>0 && prefix.length<issue.target.length && prefix.every((part,index)=>issue.target[index]===part));
  const regressions = after.issues.filter(issue => !old.has(key(issue)) && !unknownBefore(issue));
  return { before, after, regressions, unclassified: after.issues.filter(issue => !old.has(key(issue)) && unknownBefore(issue)), existing: after.issues.filter(issue => old.has(key(issue))), fixes: after.partial ? [] : before.issues.filter(issue => !current.has(key(issue))), regressed: regressions.length > 0 };
}
