import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { runCompare } from '../src/compare';
import { buildReportMarkdown } from '../src/report';
import { routeArtifactId } from '../src/util';

describe('route artifact identity',()=>{
  it('is stable, bounded and distinct for colliding slugs',()=>{
    const routes=['/','/root','/a/b','/a-b','/한글','/다른'];
    expect(new Set(routes.map(routeArtifactId)).size).toBe(routes.length);
    expect(routeArtifactId('/a//b/')).toBe(routeArtifactId('/a/b'));
    expect(routeArtifactId('/'+'a'.repeat(1000)).length).toBeLessThan(130);
  });
  it('keeps a 35-route, two-viewport evidence report below the comment size limit',()=>{
    const routes=Array.from({length:35},(_,i)=>`/documentation/a-long-reference-section/page-${i}`);
    const results=routes.flatMap(route=>['desktop','mobile'].map(viewport=>({route,viewport,status:'changed' as const,diffPercent:1,diffPixels:10,width:100,height:100,sizeMismatch:false,images:{before:`base-${routeArtifactId(route)}-${viewport}.png`,after:`head-${routeArtifactId(route)}-${viewport}.png`,diff:`${routeArtifactId(route)}-${viewport}-diff.png`},consoleErrors:{before:0,after:0}})));
    const report=buildReportMarkdown({baseLabel:'base',headLabel:'head',baseSource:'base',headSource:'head',routes,routesSource:'explicit',viewports:['desktop','mobile'],thresholdPercent:0.1,generatedAt:'2026-11-24',notes:[]},results);
    expect(report.length).toBeLessThan(65536);
    expect(Buffer.byteLength(report)).toBeLessThan(65536);
  });
  it('preserves actual route pixels and diff links in either capture order',async()=>{
    const routes=['/','/root','/a/b','/a-b','/한글','/다른'];
    const server=createServer((req,res)=>{
      const url=new URL(req.url!,'http://localhost');
      const route=decodeURIComponent(url.pathname.replace(/^\/(base|head)/,''))||'/';
      const index=routes.indexOf(route);
      const color=`rgb(${30+index*30},0,0)`;
      const patch=url.pathname.startsWith('/head')?`<div style="position:absolute;top:20px;left:${index*16}px;width:8px;height:8px;background:white"></div>`:'';
      res.setHeader('Content-Type','text/html');res.end(`<html><body style="margin:0;background:${color};height:100vh">${patch}</body></html>`);
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
          const diff=PNG.sync.read(await readFile(join(outDir,row.images.diff!)));
          const routeIndex=routes.indexOf(row.route);
          for(let slot=0;slot<routes.length;slot++){
            const pixel=(22*diff.width+slot*16+2)*4;
            expect([...diff.data.subarray(pixel,pixel+3)]).toEqual(slot===routeIndex?[255,0,90]:[diff.data[pixel],diff.data[pixel],diff.data[pixel]]);
          }
          const markdown=await readFile(result.reportPath,'utf8');
          const section=markdown.split(`### \`${row.route}\` · ${row.viewport}`)[1]!.split('### ')[0]!;
          for(const image of Object.values(row.images))expect(section).toContain(`](${image})`);
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
