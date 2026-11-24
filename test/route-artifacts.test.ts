import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { runCompare } from '../src/compare';
import { routeArtifactId } from '../src/util';

describe('route artifact identity',()=>{
  it('is stable, bounded and distinct for colliding slugs',()=>{
    const routes=['/','/root','/a/b','/a-b','/한글','/다른'];
    expect(new Set(routes.map(routeArtifactId)).size).toBe(routes.length);
    expect(routeArtifactId('/a//b/')).toBe(routeArtifactId('/a/b'));
    expect(routeArtifactId('/'+'a'.repeat(1000)).length).toBeLessThan(130);
  });
  it('preserves actual route pixels and diff links in either capture order',async()=>{
    const routes=['/','/root','/a/b','/a-b','/한글','/다른'];
    const server=createServer((req,res)=>{
      const url=new URL(req.url!,'http://localhost');
      const route=decodeURIComponent(url.pathname.replace(/^\/(base|head)/,''))||'/';
      const index=routes.indexOf(route);
      const color=url.pathname.startsWith('/head')?'white':`rgb(${30+index*30},0,0)`;
      res.setHeader('Content-Type','text/html');res.end(`<html><body style="margin:0;background:${color};height:100vh"></body></html>`);
    });server.listen(0,'127.0.0.1');await once(server,'listening');
    const dir=await mkdtemp(join(tmpdir(),'proofshot-route-'));
    try{
      const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
      const runs=[];
      for(const order of [routes,[...routes].reverse()]){
        const outDir=join(dir,String(runs.length));
        const result=await runCompare({base:origin+'/base',head:origin+'/head',routes:order,outDir,collectA11y:false,settleMs:0,viewports:[{name:'desktop',width:120,height:80}]});
        expect(result.stats.errors).toBe(0);
        expect(new Set(result.results.map(r=>r.images.before)).size).toBe(6);
        expect(new Set(result.results.map(r=>r.images.diff)).size).toBe(6);
        for(const row of result.results){
          const png=PNG.sync.read(await readFile(join(outDir,row.images.before!)));
          expect(png.data[0]).toBe(30+routes.indexOf(row.route)*30);
          expect(row.status).toBe('changed');
          expect(await readFile(join(outDir,row.images.diff!))).toBeTruthy();
          expect(await readFile(result.reportPath,'utf8')).toContain(row.images.before!);
        }runs.push(result);
      }
      for(const route of routes){
        const a=runs[0]!.results.find(r=>r.route===route)!;
        const b=runs[1]!.results.find(r=>r.route===route)!;
        expect(a.images).toEqual(b.images);expect(a.diffPercent).toBe(b.diffPercent);
      }
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
  },120000);
});
