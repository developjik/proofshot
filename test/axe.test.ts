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
 expect(await captureAxe((()=>{const frame={parentFrame:()=>null,addScriptTag:async()=>{throw new Error('blocked script')}};return {frames:()=>[frame],mainFrame:()=>frame};})() as never)).toMatchObject({status:'skipped',reason:expect.stringContaining('blocked script')});
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
 const fixed=await runCompare({...common,base:head,head:base,failOn:['a11y'],outDir:join(root,'fixed')});expect(await readFile(fixed.reportPath,'utf8')).toContain('Fixed: color-contrast');
 const textLines:string[]=[];expect(await runCli(['compare','--base',base,'--head',head,'--routes','/','--viewports','desktop=800x600','--settle','0','--a11y','axe','--fail-on','a11y','--out',join(root,'terminal')],{stdout:line=>textLines.push(line),stderr:line=>textLines.push(line)})).toBe(1);expect(textLines.join('\n')).toMatch(/\+1/);
 const existing=await runCompare({...common,base:head,failOn:['a11y'],outDir:join(root,'existing')});expect(existing.exitCode).toBe(0);expect(existing.results[0].axe?.regressions).toHaveLength(0);
 const noAxe=await runCompare({...common,axe:undefined,failOn:['a11y'],outDir:join(root,'noaxe')});expect(noAxe.results[0]).not.toHaveProperty('axe');expect(await readFile(noAxe.reportPath,'utf8')).not.toContain('## axe accessibility delta');
 const lines:string[]=[];const code=await runCli(['compare','--base',base,'--head',head,'--routes','/','--viewports','desktop=800x600','--settle','0','--a11y','axe','--fail-on','a11y','--out',join(root,'cli'),'--json'],{stdout:line=>lines.push(line),stderr:line=>lines.push(line)});expect(code).toBe(1);expect(lines.join('\n')).toContain('color-contrast');
 }finally{await rm(root,{recursive:true,force:true});}
},30000);

test('incomplete head result is not counted as fixed',()=>{
 const issue={rule:'color-contrast',impact:'serious',target:['#text'],detail:'manual'};
 expect(computeAxeDelta({status:'ok',issues:[issue]},{status:'ok',issues:[],uncertain:[issue],incomplete:1}).fixes).toEqual([]);
});
test('axe injects every frame and reports iframe violations',async()=>{
 const {chromium}=await import('playwright');const {createServer}=await import('node:http');
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url==='/child'?'<html lang="en"><title>Inside</title><main><img id="missing" width="100" height="100" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></main></html>':'<html lang="en"><title>Frames</title><main><h1>Frames</h1><section><iframe title="Embedded" src="/child"></iframe></section><aside><iframe title="Second" src="/child"></iframe></aside></main>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address();if(!addr||typeof addr==='string')throw new Error('port');
 const browser=await chromium.launch({executablePath:process.env.PROOFSHOT_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${addr.port}`);await page.frameLocator('iframe').first().locator('#missing').waitFor();
 const result=await captureAxe(page);expect(result.status).toBe('ok');expect(result.issues).toContainEqual(expect.objectContaining({rule:'image-alt'}));expect(result.issues.find(x=>x.rule==='image-alt')?.target.length).toBeGreaterThan(1);const targets=result.issues.filter(x=>x.rule==='image-alt').map(x=>JSON.stringify(x.target));expect(new Set(targets).size).toBe(2);
 }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},20000);

test('CSP-blocked axe skip does not create lightweight console regression',async()=>{
 const {createServer}=await import('node:http');const root=await mkdtemp(join(tmpdir(),'proofshot-csp-'));
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.url?.startsWith('/head'))res.setHeader('Content-Security-Policy',"script-src 'none'");res.end('<html lang="en"><title>Clean CSP</title><main><h1>Same page</h1><p>Ordinary content.</p></main></html>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address();if(!addr||typeof addr==='string')throw new Error('port');
 try{const origin=`http://127.0.0.1:${addr.port}`;const result=await runCompare({base:origin+'/base',head:origin+'/head',routes:['/'],viewports:[{name:'desktop',width:800,height:600}],settleMs:0,axe:true,failOn:['a11y'],outDir:root});expect(result.exitCode).toBe(0);expect(result.results[0].axe?.after.status).toBe('skipped');expect(result.results[0].a11y?.regressions).toHaveLength(0);expect(result.results[0].consoleErrors.after).toBe(0);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);

test('partial frame audit never infers fixes',()=>{const issue={rule:'image-alt',impact:'critical',target:['iframe','#old'],detail:'alt'};expect(computeAxeDelta({status:'ok',issues:[issue]},{status:'ok',issues:[],partial:true}).fixes).toEqual([]);});

test('blocked child frame preserves top-level violations and marks audit partial',async()=>{
 const {chromium}=await import('playwright');const {createServer}=await import('node:http');const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.url==='/child')res.setHeader('Content-Security-Policy',"script-src 'none'");res.end(req.url==='/child'?'<html lang="en"><title>Blocked child</title><main>Child</main></html>':'<html lang="en"><title>Top</title><main><h1>Top</h1><img id="top-missing" width="100" height="100" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><iframe title="Child" src="/child"></iframe></main></html>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address();if(!addr||typeof addr==='string')throw new Error('port');const browser=await chromium.launch({executablePath:process.env.PROOFSHOT_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${addr.port}`);const result=await captureAxe(page);expect(result.status).toBe('ok');expect(result.partial).toBe(true);expect(result.issues).toContainEqual(expect.objectContaining({rule:'image-alt',target:['#top-missing']}));}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},20000);

test('previously unaudited frame violations are not called new while top-level remains comparable',()=>{
 const issue={rule:'image-alt',impact:'critical',target:['#child','#image'],detail:'alt'};const top={...issue,target:['#top']};const delta=computeAxeDelta({status:'ok',issues:[],partial:true,unauditedFrames:[['#child']]},{status:'ok',issues:[issue,top]});expect(delta.regressions).toEqual([top]);
});
