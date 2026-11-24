import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompare } from '../src/compare';

it('observer runs before navigation and after scene steps on the captured page', async () => {
 const cwd = await mkdtemp(join(tmpdir(),'proofshot-observer-')); await mkdir(join(cwd,'site'));
 await writeFile(join(cwd,'site','index.html'), '<button id="open" onclick="document.querySelector(\'#done\').hidden=false">Open</button><p id="done" hidden>Done</p>');
 const seen: string[] = [];
 const result = await runCompare({cwd,base:join(cwd,'site'),head:join(cwd,'site'),routes:['/'],scenes:[{name:'open',route:'/',steps:[{action:'click',selector:'#open'}],expect:'#done'}],viewports:[{name:'small',width:400,height:400}],settleMs:0,observer:{
  async beforeNavigate(page,capture){ await page.addInitScript('window.__observerReady = true'); seen.push(`${capture.side}:${capture.scene ?? 'route'}:init`); },
  async beforeScreenshot(page,capture){ expect(await page.evaluate('window.__observerReady')).toBe(true); if(capture.scene)expect(await page.locator('#done').isVisible()).toBe(true); seen.push(`${capture.side}:${capture.scene ?? 'route'}:capture`); }
 }});
 expect(result.stats.errors).toBe(0); expect(seen).toHaveLength(8);
 for(const side of ['base','head'])expect(seen.indexOf(`${side}:open:init`)).toBeLessThan(seen.indexOf(`${side}:open:capture`));
},30000);
it('observer exception fails the affected capture instead of passing silently',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'proofshot-observer-fail-'));await mkdir(join(cwd,'site'));await writeFile(join(cwd,'site','index.html'),'<h1>fixture</h1>');
 const result=await runCompare({cwd,base:join(cwd,'site'),head:join(cwd,'site'),routes:['/'],viewports:[{name:'small',width:400,height:400}],settleMs:0,observer:{async beforeScreenshot(){throw new Error('observer unavailable');}}});
 expect(result.stats.errors).toBe(1);expect(result.results[0]?.error).toContain('observer unavailable');
},30000);
