#!/usr/bin/env node
// Optional local integration. No network target, publication, PR posting or extra dependency in proofshot.
import { readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runCompare, normalizeScenes } from '../../dist/src/index.js';

const hash = x => createHash('sha256').update(x).digest('hex');
export function bindEvidence(binding, actual) {
  for (const key of ['sceneHash', 'baseCommit', 'headCommit', 'viewportHash']) if (binding[key] !== actual[key]) throw new Error(`Evidence binding mismatch: ${key}`);
}
const md = value => String(value).replace(/[\\`*_{}\[\]()<>|!#\r\n]/g, c => /[\r\n]/.test(c) ? ' ' : `\\${c}`);
const link = file => file.split(sep).map(encodeURIComponent).join('/');
async function targetInfo(path, commit) {
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Symlink build roots are not accepted');
  const dir = await realpath(path);
  if (!(await lstat(dir)).isDirectory()) throw new Error('Only local build directories are accepted');
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Use full commit SHAs');
  const actual = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actual !== commit) throw new Error('Target checkout HEAD does not match manifest commit');
  const root = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
  if (status) throw new Error('Target checkout has tracked changes; use a clean worktree');
  // Build outputs can be untracked; their bytes are separately hashed below.
  const entries = [];
  const { readdir } = await import('node:fs/promises');
  const walk = async (current, prefix = '') => {
    for (const item of (await readdir(current, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (item.name === '.git' || item.name === 'node_modules') throw new Error('Point at the static build directory, not the repository root');
      const file = join(current, item.name), name = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error('Symlink build inputs are not accepted');
      if (item.isDirectory()) await walk(file, name + '/');
      else if (item.isFile()) { const stat = await lstat(file); if (stat.size > 8 * 1024 * 1024 || entries.length >= 1000) throw new Error('Build input exceeds sample bounds'); entries.push([name, hash(await readFile(file))]); }
      else throw new Error('Non-regular build input');
    }
  };
  await walk(dir);
  return { dir, commit, contentHash: hash(JSON.stringify(entries)) };
}

export async function runPack(config, livesay) {
  const scenes = normalizeScenes(config.scenes);
  if (scenes.length > 20) throw new Error('Sample supports at most 20 scenes');
  if (!scenes.length) throw new Error('At least one existing proofshot SceneSpec is required');
  const viewport = config.viewport ?? { name: 'desktop', width: 1280, height: 800 };
  if (!/^[a-zA-Z0-9_-]+$/.test(viewport.name) || !Number.isInteger(viewport.width) || !Number.isInteger(viewport.height) || viewport.width < 200 || viewport.width > 3000 || viewport.height < 200 || viewport.height > 3000) throw new Error('Invalid viewport');
  const base = await targetInfo(config.base, config.baseCommit), head = await targetInfo(config.head, config.headCommit);
  let out = resolve(config.out);
  // Resolve existing parent aliases before overlap checks.
  await mkdir(resolve(out, '..'), { recursive: true });
  out = join(await realpath(resolve(out, '..')), out.split(sep).at(-1));
  try { if ((await lstat(out)).isSymbolicLink()) throw new Error('Symlink output is not accepted'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { if ((await (await import('node:fs/promises')).readdir(out)).length) throw new Error('Output directory must be empty'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const target of [base.dir, head.dir]) { const rel = relative(target, out); if (!rel || (!rel.startsWith('..' + sep) && !isAbsolute(rel) && rel !== '..')) throw new Error('Output must be outside both build directories'); }
  await mkdir(out, { recursive: true });
  const binding = { sceneHash: hash(JSON.stringify(scenes)), viewportHash: hash(JSON.stringify(viewport)), baseCommit: base.commit, headCommit: head.commit };
  const captures = new Map(); const failures = [];
  const key = capture => `${capture.side}\0${capture.scene}`;
  const observer = {
    async beforeNavigate(page, capture) {
      // Local-only synthetic build inspection. Prevent redirects/subresources/WebSockets escaping loopback.
      await page.context().route('**/*', route => {
        const u = new URL(route.request().url());
        return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ? route.continue() : route.abort();
      });
      await page.context().routeWebSocket('**/*', socket => socket.close());
      page.on('popup', popup => popup.close());
      try { await livesay.installProbe(page); } catch { failures.push({ side: capture.side, scene: capture.scene, reason: 'probe-install-failed' }); }
    },
    async beforeScreenshot(page, capture) {
      if (!capture.scene) return;
      try {
        const status = await livesay.waitForAnswer(page, { timeoutMs: 1500 });
        if (status !== 'marked') throw new Error('answer end not observed');
        await page.waitForTimeout(300);
        const snapshot = await livesay.readProbeSnapshot(page);
        if (!snapshot.events.length || !snapshot.answers.some(a => a.outcome !== 'running')) throw new Error('empty recording');
        const report = livesay.audit(snapshot, { profile: 'nvda-like' });
        const item = { binding: { ...binding }, scene: capture.scene, side: capture.side, report };
        captures.set(key(capture), item);
      } catch { failures.push({ side: capture.side, scene: capture.scene, reason: 'announcement-unverified' }); }
    },
  };
  const visual = await runCompare({ base: base.dir, head: head.dir, baseRef: base.commit, headRef: head.commit, routes: [...new Set(scenes.map(s => s.route))], scenes, viewports: [viewport], outDir: out, observer, settleMs: 100, collectA11y: true });
  // Refuse targets that changed during capture, even with unchanged git HEAD.
  for (const [input, before] of [[config.base, base], [config.head, head]]) {
    if ((await targetInfo(input, before.commit)).contentHash !== before.contentHash) throw new Error('Build input changed during capture');
  }
  const rows = [];
  for (const [index, scene] of scenes.entries()) {
    const v = visual.results.find(r => r.scene === scene.name && r.viewport === viewport.name && r.route === scene.route);
    const before = captures.get(`base\0${scene.name}`), after = captures.get(`head\0${scene.name}`);
    const row = { scene: scene.name, binding, status: 'unverified', visual: v ?? null, announcement: null, files: {} };
    if (before && after && v && v.status !== 'error') {
      bindEvidence(binding, before.binding); bindEvidence(binding, after.binding);
      if (before.scene !== scene.name || after.scene !== scene.name) throw new Error('Scene identity mismatch');
      const delta = livesay.compareReports(before.report, after.report);
      row.status = 'verified'; row.announcement = delta;
      row.transcripts = { base: before.report.utterances.map(u => u.text), head: after.report.utterances.map(u => u.text) };
      for (const [side, report] of [['base', before.report], ['head', after.report]]) {
        const json = `scene-${index}-${side}-livesay.json`, html = `scene-${index}-${side}-livesay.html`;
        await writeFile(join(out, json), JSON.stringify({ binding, scene: scene.name, report }, null, 2));
        await writeFile(join(out, html), livesay.renderHtml(report));
        row.files[side] = { json, html };
      }
    }
    rows.push(row);
  }
  const pack = { schema: 'proofshot.livesay-pack/v1', binding, sources: { base, head }, tools: { proofshot: JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version, livesay: livesay.VERSION }, generatedAt: new Date().toISOString(), rows, failures };
  await writeFile(join(out, 'evidence-pack.json'), JSON.stringify(pack, null, 2));
  const lines = ['## Visual and announcement evidence', '', `Commits: ${binding.baseCommit} to ${binding.headCommit}`, '', 'Simulated announcement profile, not real screen-reader or WCAG certification.', '', '[Visual + DOM report](report.md) | [Full evidence binding](evidence-pack.json)', ''];
  for (const [index,row] of rows.entries()) {
    lines.push(`### ${md(row.scene)}`, '', `Collection: ${row.status}. Visual: ${row.visual?.status ?? 'missing'}.`, '');
    for (const [name,path] of Object.entries(row.visual?.images ?? {})) if (path) lines.push(`[${name} screenshot](${link(path)})`);
    if (row.status === 'verified') {
      lines.push('', `[Base announcements](${row.files.base.html}) | [Head announcements](${row.files.head.html})`, '', `New findings: ${row.announcement.added.length}. Resolved: ${row.announcement.resolved.length}.`, '', '| Metric | Before | After | Delta |', '| --- | --- | --- | --- |');
      for (const metric of row.announcement.metrics) lines.push(`| ${md(metric.metric)} | ${metric.before} | ${metric.after} | ${metric.delta} |`);
      lines.push('', '#### Simulated transcript text', '', '| Before | After |', '| --- | --- |');
      for (let i = 0; i < Math.max(row.transcripts.base.length, row.transcripts.head.length); i++) lines.push(`| ${md(row.transcripts.base[i] ?? '')} | ${md(row.transcripts.head[i] ?? '')} |`);
    } else lines.push('', 'Announcement capture is UNVERIFIED, never treated as an empty passing transcript. See evidence-pack.json for failures.');
    lines.push('');
  }
  await writeFile(join(out, 'pr-comment.md'), lines.join('\n'));
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const panels = rows.map(row => `<section><h2>${esc(row.scene)}</h2><p>Collection: ${esc(row.status)}. Visual: ${esc(row.visual?.status ?? 'missing')}.</p><div class=images>${Object.entries(row.visual?.images ?? {}).filter(([name,path])=>path&&name!=='diff').map(([name,path])=>`<figure><figcaption>${esc(name)}</figcaption><a href="${link(path)}"><img src="${link(path)}" alt="${esc(name)} scene"></a></figure>`).join('')}</div>${row.transcripts ? `<h3>Simulated transcript</h3><p>Before: ${row.transcripts.base.map(esc).join(' / ')}</p><p>After: ${row.transcripts.head.map(esc).join(' / ')}</p><p><a href="${row.files.base.html}">Base original</a> | <a href="${row.files.head.html}">Head original</a></p>` : '<p>UNVERIFIED: announcement capture unavailable.</p>'}</section>`).join('');
  await writeFile(join(out,'index.html'), `<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Visual and announcement evidence</title><style>body{font:17px system-ui;background:#f2f6f8;color:#173144;margin:24px}main{max-width:1200px;margin:auto}h1{font-size:30px}p{line-height:1.5;overflow-wrap:anywhere}section{background:white;border:1px solid #b5cbd4;padding:20px;margin:24px 0;border-radius:12px}.images{display:flex;gap:16px}figure{margin:0;min-width:0;flex:1}img{width:100%;border:1px solid #d4e0e5}figcaption{font-weight:600;margin:8px 0}a{color:#075a80}@media(max-width:600px){.images{display:block}body{margin:16px}section{padding:12px}}</style><main><h1>Visual + announcement evidence</h1><p>Same scene, steps, viewport and commit pair. Local synthetic fixture. Announcement simulation is not real screen-reader certification.</p><p>Base ${binding.baseCommit}<br>Head ${binding.headCommit}</p><p><a href="pr-comment.md">PR comment Markdown</a> | <a href="report.md">Visual + DOM original</a> | <a href="evidence-pack.json">Full binding and failures</a></p>${panels}</main></html>`);
  return pack;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const modulePath = await realpath(process.argv[3]);
    if (!isAbsolute(modulePath)) throw new Error('Use an absolute local livesay dist/index.js path');
    const livesay = await import(pathToFileURL(modulePath).href);
    const pack = await runPack(config, livesay);
    console.log(`Wrote ${pack.rows.length} scene(s). Unverified: ${pack.rows.filter(r => r.status !== 'verified').length}`);
    process.exitCode = pack.rows.some(r => r.status !== 'verified') ? 1 : 0;
  } catch (error) { console.error(`Evidence pack failed: ${error.message}`); process.exitCode = 1; }
}
