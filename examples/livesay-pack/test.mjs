import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runPack, bindEvidence } from './run.mjs';
const livesay = await import(pathToFileURL(resolve(process.argv[2])).href);
const config = JSON.parse(await readFile(process.argv[3], 'utf8'));
test('binding refuses scene, step/viewport, and either commit drift', () => {
 const b={sceneHash:'s',viewportHash:'v',baseCommit:'a',headCommit:'b',baseContentHash:'x',headContentHash:'y'};
 for(const key of Object.keys(b))assert.throws(()=>bindEvidence(b,{...b,[key]:'wrong'}),/mismatch/);
});
test('missing announcement markers leave scene unverified, not passing',async()=>{
 const out=await mkdtemp(join(tmpdir(),'pack-negative-'));
 const broken={...livesay,readProbeSnapshot:async()=> {throw new Error('probe failure');}};
 const pack=await runPack({...config,out},broken);
 assert.equal(pack.rows[0].status,'unverified');
 assert.equal(pack.rows[0].announcement,null);
 assert.match(await readFile(join(out,'pr-comment.md'),'utf8'),/UNVERIFIED/);
});
test('capture failure leaves scene unverified while report artifacts remain',async()=>{
 const out=await mkdtemp(join(tmpdir(),'pack-blocked-'));
 const scenes=config.scenes.map(s=>({...s,expect:'#does-not-exist'}));
 const pack=await runPack({...config,out,scenes},livesay);
 assert.equal(pack.rows[0].status,'unverified');
 assert.equal(pack.rows[0].visual.status,'error');
 assert.ok(await readFile(join(out,'report.json'),'utf8'));
});
test('wrong commit and output/input overlap are refused',async()=>{
 await assert.rejects(runPack({...config,baseCommit:'0'.repeat(40)},livesay),/HEAD/);
 await assert.rejects(runPack({...config,out:config.base},livesay),/Output/);
});

async function fixture(script, route='/') {
 const root=await mkdtemp(join(tmpdir(),'pack-multi-'));await mkdir(join(root,'build'));
 await writeFile(join(root,'build','index.html'),`<button id=open>Open</button><p id=result role=status aria-live=polite></p><script>${script}</script>`);
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('add','build');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');
 return {...config,base:join(root,'build'),head:join(root,'build'),baseCommit:git('rev-parse','HEAD'),headCommit:git('rev-parse','HEAD'),out:await mkdtemp(join(tmpdir(),'pack-case-')),scenes:[{name:'case',route,steps:[{action:'click',selector:'#open'}],expect:'#result'}]};
}
test('an earlier ended answer cannot verify the running scene answer',async()=>{
 const c=await fixture(`const p=window.__livesayProbe;p.mark('start',{id:'old'});p.mark('done',{id:'old'});document.querySelector('#open').onclick=()=>{p.mark('start',{id:'current'});document.querySelector('#result').textContent='Still running';};`);
 const pack=await runPack(c,livesay);assert.equal(pack.rows[0].status,'unverified');
});
test('late completion announcement within default grace is included',async()=>{
 const c=await fixture(`document.querySelector('#open').onclick=()=>{const p=window.__livesayProbe;p.mark('start',{id:'current'});p.mark('done',{id:'current'});setTimeout(()=>document.querySelector('#result').textContent='Completed.',700);};`);
 const pack=await runPack(c,livesay);assert.equal(pack.rows[0].status,'verified');assert.match(pack.rows[0].transcripts.head.join(' '),/Completed/);
});
test('comparison cap preserves originals and does not stop other scene records',async()=>{
 const out=await mkdtemp(join(tmpdir(),'pack-cap-'));
 const pack=await runPack({...config,out}, {...livesay,compareReports(){throw new Error('findings capped');}});
 assert.equal(pack.rows[0].status,'unverified');assert.ok(pack.rows[0].files.base.json);assert.ok(pack.rows[0].files.head.json);assert.ok(await readFile(join(out,'evidence-pack.json')));
});
test('one-sided probe failure preserves the other original',async()=>{
 const out=await mkdtemp(join(tmpdir(),'pack-one-side-'));let origin;
 const wrapped={...livesay,async readProbeSnapshot(page){const s=await livesay.readProbeSnapshot(page);origin??=new URL(s.url).origin;if(new URL(s.url).origin!==origin)throw new Error('one side');return s;}};
 const pack=await runPack({...config,out},wrapped);
 assert.equal(pack.rows[0].status,'unverified');assert.equal(Object.keys(pack.rows[0].files).length,1);
});
test('route params are normalized before evidence binding',async()=>{
 const c=await fixture(`document.querySelector('#open').onclick=()=>{const p=window.__livesayProbe;p.mark('start',{id:'x'});document.querySelector('#result').textContent='Completed.';p.mark('done',{id:'x'});};`,'/:item');
 const pack=await runPack({...c,params:{item:'example'}},livesay);assert.equal(pack.rows[0].status,'verified');assert.equal(pack.rows[0].visual.route,'/example');
});

test('each later answer gets its own completion grace',async()=>{
 const c=await fixture(`document.querySelector('#open').onclick=()=>{const p=window.__livesayProbe;p.mark('start',{id:'first'});p.mark('done',{id:'first'});setTimeout(()=>{p.mark('start',{id:'second'});setTimeout(()=>p.mark('done',{id:'second'}),200);setTimeout(()=>document.querySelector('#result').textContent='Second completed.',1000);},700);};`);
 const pack=await runPack(c,livesay);assert.equal(pack.rows[0].status,'verified');assert.match(pack.rows[0].transcripts.head.join(' '),/Second completed/);
});
