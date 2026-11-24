import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { runCompare } from '../src/compare';
import { normalizeScenes } from '../src/scenes';
import { runCli } from '../src/cli';
import { sceneArtifactId } from '../src/util';
import { renderWorkflowTemplate } from '../src/init';

const scene = { name: 'open modal', route: '/', steps: [{ action: 'click' as const, selector: '#open' }, { action: 'wait' as const, selector: '#modal' }], expect: '#modal' };

describe('scene grammar', () => {
  it('keeps slash-distinct scene names in separate artifact namespaces', () => { expect(sceneArtifactId('/', 'a//b')).not.toBe(sceneArtifactId('/', 'a/b')); });
  it('validates direct API and JSON shape without accepting executable code', () => {
    expect(normalizeScenes([scene])[0]).toEqual(scene);
    for (const value of [[scene, scene], [{ ...scene, route: 'https://other.test' }], [{ ...scene, steps: [{ action: 'evaluate', value: 'bad' }] }], [{ ...scene, steps: [{ action: 'fill', selector: '#input' }] }], [{ ...scene, steps: [{ action: 'wait', selector: '#x', text: 'x' }] }]]) expect(() => normalizeScenes(value)).toThrow();
  });
  it('keeps evidence uploads unconditional in the generated workflow', () => {
    expect(renderWorkflowTemplate()).toMatch(/name: Upload evidence\n\s+if: always\(\)/);
  });
});

it('captures two-step modal scenes on both sides, preserves routes, and isolates blocked scenes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'proofshot-scenes-'));
  for (const side of ['before', 'after']) {
    await mkdir(join(cwd, side));
    await writeFile(join(cwd, side, 'index.html'), `<!doctype html><html><head><title>Scenes</title><style>body{font:20px sans-serif;padding:30px}#modal{padding:32px;border:4px solid navy;background:#eef}input,button{font:inherit}</style></head><body><h1>Scene fixture</h1><button hidden>Open modal</button><button id="open" onclick="document.querySelector('#modal').hidden=false;localStorage.setItem('scene-dirty','yes')">Open modal</button><p id="storage-clean" hidden>Clean storage</p><script>if(!localStorage.getItem("scene-dirty"))document.querySelector("#storage-clean").hidden=false;</script><section id="modal" role="dialog" aria-label="Details" hidden><h2>${side === 'before' ? 'Original modal' : 'Updated modal'}</h2><input id="name" aria-label="Name"><button onclick="document.querySelector('#error').hidden=false">Submit</button><p id="error" hidden>Enter a valid name</p><div style="height:900px"></div><img loading="lazy" id="lazy" width="100" height="60" data-src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60'%3E%3Crect width='100' height='60' fill='red'/%3E%3C/svg%3E" ${side === 'before' ? 'alt="sample"' : ''}></section><script>const img=document.querySelector("#lazy");new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){img.src=img.dataset.src;}},{rootMargin:"0px"}).observe(img);</script></body></html>`);
  }
  const scenes = [scene, { name: 'form error', route: '/', steps: [{ action: 'click' as const, text: 'Open modal' }, { action: 'fill' as const, selector: '#name', value: 'invalid' }, { action: 'press' as const, selector: '#name', value: 'Tab' }, { action: 'click' as const, text: 'Submit' }], expect: '#error' }, { name: 'blocked', route: '/', steps: [], expect: '#missing' }, { name: 'clean storage', route: '/', steps: [], expect: '#storage-clean' }];
  const outDir = join(cwd, 'report');
  const result = await runCompare({ cwd, base: join(cwd, 'before'), head: join(cwd, 'after'), routes: ['/'], scenes, outDir, viewports: [{ name: 'desktop', width: 1000, height: 760 }], settleMs: 0, threshold: 0.001, failOn: ['error'] });
  expect(result.exitCode).toBe(1);
  expect(result.results).toHaveLength(5);
  expect(result.results.find(item => !item.scene)?.status).toBe('unchanged');
  const modal = result.results.find(item => item.scene === 'open modal')!;
  expect(modal.status).toBe('changed');
  expect(modal.a11y?.regressions.some(issue => issue.rule === 'img-alt')).toBe(true);
  expect(result.results.find(item => item.scene === 'form error')?.images.after).toBeTruthy();
  expect(result.results.find(item => item.scene === 'blocked')?.blocked).toBe(true);
  expect(result.results.find(item => item.scene === 'clean storage')?.status).not.toBe('error');
  const image = PNG.sync.read(await readFile(join(outDir, modal.images.after!)));
  let red = 0; for (let i = 0; i < image.data.length; i += 4) if (image.data[i]! > 240 && image.data[i+1]! < 20 && image.data[i+2]! < 20) red++;
  expect(red).toBeGreaterThan(5000);
  const images = result.results.flatMap(item => Object.values(item.images).filter(Boolean));
  expect(new Set(images).size).toBe(images.length);
  const report = await readFile(result.reportPath, 'utf8');
  expect(report).toContain('## Scenes');
  expect(report).toContain('blocked');
  expect(report).toContain('Scene: open modal');
  await copyFile(join(outDir, modal.images.before!), '/tmp/61-modal-before.png');
  await copyFile(join(outDir, modal.images.after!), '/tmp/61-modal-after.png');
  // CLI route mapping includes scenes only for matching routes.
  await writeFile(join(cwd, '.proofshot.json'), JSON.stringify({ routes: ['/'], scenes }));
  const lines: string[] = [];
  expect(await runCli(['routes', '--files', 'src/App.tsx', '--json'], { cwd, stdout: line => lines.push(line) })).toBe(0);
  expect(JSON.parse(lines.join('')).scenes).toHaveLength(4);
}, 90000);

it('uses one normalized identity after dynamic params end with a slash', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'proofshot-scenes-params-'));
  await mkdir(join(cwd, 'site', 'item', 'one'), { recursive: true });
  await writeFile(join(cwd, 'site', 'item', 'one', 'index.html'), '<h1 id="ready">Param scene</h1>');
  await writeFile(join(cwd, '.proofshot.json'), JSON.stringify({ routes: ['/item/:id'], params: { id: 'one/' }, scenes: [{ name: 'param', route: '/item/:id', steps: [], expect: '#ready' }] }));
  const result = await runCompare({ cwd, base: join(cwd, 'site'), head: join(cwd, 'site'), viewports: [{ name: 'desktop', width: 700, height: 500 }], settleMs: 0 });
  expect(result.results).toHaveLength(2);
  expect(result.results.find(item => item.scene)?.status).toBe('unchanged');
}, 30000);

it('preserves the post-action scroll position for viewport-only scenes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'proofshot-scenes-scroll-'));
  const site = join(cwd, 'site'); await mkdir(site);
  await writeFile(join(site, 'index.html'), `<h1>Top</h1><div style="height:1800px"></div><button id="show" onclick="document.querySelector('#panel').hidden=false">Show result</button><div id="panel" hidden style="height:100px;width:100%;background:rgb(255,0,0)">Result</div>`);
  const result = await runCompare({ cwd, base: site, head: site, routes: ['/'], scenes: [{ name: 'below fold', route: '/', steps: [{ action: 'click', selector: '#show' }], expect: '#panel' }], viewports: [{ name: 'desktop', width: 700, height: 500 }], fullPage: false, settleMs: 0 });
  const capture = result.results.find(item => item.scene)!;
  expect(capture.status).toBe('unchanged');
  const png = PNG.sync.read(await readFile(join(result.outDir, capture.images.after!)));
  let red = 0; for (let i=0;i<png.data.length;i+=4) if(png.data[i]!>240&&png.data[i+1]!<20&&png.data[i+2]!<20)red++;
  expect(red).toBeGreaterThan(1000);
}, 30000);
