import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPack, bindEvidence } from './run.mjs';
const livesay = await import(pathToFileURL(resolve(process.argv[2])).href);
const config = JSON.parse(await readFile(process.argv[3], 'utf8'));
test('binding refuses scene, step/viewport, and either commit drift', () => {
 const b={sceneHash:'s',viewportHash:'v',baseCommit:'a',headCommit:'b'};
 for(const key of Object.keys(b))assert.throws(()=>bindEvidence(b,{...b,[key]:'wrong'}),/mismatch/);
});
test('missing announcement markers leave scene unverified, not passing',async()=>{
 const out=await mkdtemp(join(tmpdir(),'pack-negative-'));
 const broken={...livesay,waitForAnswer:async()=> 'timeout'};
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
