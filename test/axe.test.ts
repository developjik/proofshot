import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompare } from '../src/compare';
import { captureAxe, computeAxeDelta } from '../src/axe';
import { runCli } from '../src/cli';
test('axe delta separates new and existing violations by rule and selector',()=>{
 const old={status:'ok' as const,issues:[{rule:'image-alt',impact:'critical',target:['#img'],detail:'alt'}]};
 const next={status:'ok' as const,issues:[...old.issues,{rule:'color-contrast',impact:'serious',target:['#text'],detail:'contrast'}]};
 const delta=computeAxeDelta(old,next);expect(delta.existing).toEqual(old.issues);expect(delta.regressions).toEqual([next.issues[1]]);expect(delta.regressed).toBe(true);
 expect(computeAxeDelta({status:'skipped',reason:'missing',issues:[]},next).regressed).toBe(false);
});
test('unsupported page reports skipped with its reason',async()=>{
 expect(await captureAxe({addScriptTag:async()=>{throw new Error('blocked script')}} as never)).toMatchObject({status:'skipped',reason:expect.stringContaining('blocked script')});
});
test('missing optional dependency reports skipped without touching page',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'proofshot-noaxe-'));try{expect(await captureAxe({} as never,cwd)).toMatchObject({status:'skipped',reason:expect.stringContaining('not installed')});}finally{await rm(cwd,{recursive:true,force:true});}
});
test('real contrast violation fails a11y gate, appears in JSON and PR markdown, and is existing on baseline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'proofshot-axe-'));const base=join(root,'base'),head=join(root,'head');await mkdir(base);await mkdir(head);
 const html=(color:string)=>`<!doctype html><html lang="en"><title>Contrast check</title><main><h1>Accessible heading</h1><p id="contrast" style="color:${color};background:white;font:16px Arial">Read this contrast verification paragraph.</p><img id="existing" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="8" height="8"></main></html>`;
 await writeFile(join(base,'index.html'),html('#111'));await writeFile(join(head,'index.html'),html('#aaa'));
 try{
 const common={base,head,routes:['/'],viewports:[{name:'desktop',width:800,height:600}],settleMs:0,axe:true,failOn:['a11y'] as const};
 const result=await runCompare({...common,failOn:['a11y'],outDir:join(root,'out')});
 expect(result.exitCode).toBe(1);expect(result.results[0].axe?.regressions).toContainEqual(expect.objectContaining({rule:'color-contrast',target:['#contrast']}));expect(result.results[0].axe?.existing).toContainEqual(expect.objectContaining({rule:'image-alt'}));
 const json=JSON.parse(await readFile(result.jsonPath,'utf8'));expect(json.results[0].axe.regressions.some((issue:{rule:string})=>issue.rule==='color-contrast')).toBe(true);
 const md=await readFile(result.reportPath,'utf8');expect(md).toContain('New: color-contrast');expect(md).toContain('Existing: image-alt');
 const existing=await runCompare({...common,base:head,failOn:['a11y'],outDir:join(root,'existing')});expect(existing.exitCode).toBe(0);expect(existing.results[0].axe?.regressions).toHaveLength(0);
 const noAxe=await runCompare({...common,axe:undefined,failOn:['a11y'],outDir:join(root,'noaxe')});expect(noAxe.results[0]).not.toHaveProperty('axe');expect(await readFile(noAxe.reportPath,'utf8')).not.toContain('## axe accessibility delta');
 const lines:string[]=[];const code=await runCli(['compare','--base',base,'--head',head,'--routes','/','--viewports','desktop=800x600','--settle','0','--a11y','axe','--fail-on','a11y','--out',join(root,'cli'),'--json'],{stdout:line=>lines.push(line),stderr:line=>lines.push(line)});expect(code).toBe(1);expect(lines.join('\n')).toContain('color-contrast');
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
