import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runCompare } from '../src/compare';
import { normalizeScenes } from '../src/scenes';
import { runCli } from '../src/cli';
import { renderWorkflowTemplate } from '../src/init';

const scene = { name: 'open modal', route: '/', steps: [{ action: 'click' as const, selector: '#open' }, { action: 'wait' as const, selector: '#modal' }], expect: '#modal' };

describe('scene grammar', () => {
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
    await writeFile(join(cwd, side, 'index.html'), `<!doctype html><html><head><title>Scenes</title><style>body{font:20px sans-serif;padding:30px}#modal{padding:32px;border:4px solid navy;background:#eef}input,button{font:inherit}</style></head><body><h1>Scene fixture</h1><button id="open" onclick="document.querySelector('#modal').hidden=false">Open modal</button><section id="modal" role="dialog" aria-label="Details" hidden><h2>${side === 'before' ? 'Original modal' : 'Updated modal'}</h2><input id="name" aria-label="Name"><button onclick="document.querySelector('#error').hidden=false">Submit</button><p id="error" hidden>Enter a valid name</p><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/%3E" ${side === 'before' ? 'alt="sample"' : ''}></section></body></html>`);
  }
  const scenes = [scene, { name: 'form error', route: '/', steps: [{ action: 'click' as const, text: 'Open modal' }, { action: 'fill' as const, selector: '#name', value: 'invalid' }, { action: 'press' as const, selector: '#name', value: 'Tab' }, { action: 'click' as const, text: 'Submit' }], expect: '#error' }, { name: 'blocked', route: '/', steps: [], expect: '#missing' }];
  const outDir = join(cwd, 'report');
  const result = await runCompare({ cwd, base: join(cwd, 'before'), head: join(cwd, 'after'), routes: ['/'], scenes, outDir, viewports: [{ name: 'desktop', width: 1000, height: 760 }], settleMs: 0, failOn: ['error'] });
  expect(result.exitCode).toBe(1);
  expect(result.results).toHaveLength(4);
  expect(result.results.find(item => !item.scene)?.status).toBe('unchanged');
  const modal = result.results.find(item => item.scene === 'open modal')!;
  expect(modal.status).toBe('changed');
  expect(modal.a11y?.regressions.some(issue => issue.rule === 'img-alt')).toBe(true);
  expect(result.results.find(item => item.scene === 'form error')?.images.after).toBeTruthy();
  expect(result.results.find(item => item.scene === 'blocked')?.blocked).toBe(true);
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
  expect(JSON.parse(lines.join('')).scenes).toHaveLength(3);
}, 90000);
