import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFiles, revParse, shortSha } from '../src/git';
import { inferRoutes } from '../src/routes';
import { runCli } from '../src/cli';
import { runCompare } from '../src/compare';

const dirs: string[] = [];
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'proofshot-git-'));
  dirs.push(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Synthetic test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'core.quotePath', 'true');
  git('commit', '--quiet', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  const add = (paths: string[]) => {
    for (const path of paths) {
      const file = join(cwd, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'export default function Page() { return null; }\n');
    }
    git('add', '--all');
    git('commit', '--quiet', '-m', 'synthetic pages');
  };
  return { cwd, git, base, add };
}
afterEach(() => { for(const dir of dirs.splice(0)) rmSync(dir, {recursive:true,force:true}); });

describe('real Git changed-file paths', () => {
  it('preserves Korean App Router paths through route inference with quotePath=true', () => {
    const f = fixture();
    f.add(['app/설정/page.tsx', 'app/pricing/page.tsx']);
    const result = changedFiles({cwd:f.cwd,baseRef:f.base});
    expect(result.warning).toBeUndefined();
    expect(result.range).toBe(`${f.base}...HEAD`);
    expect(result.files).toEqual(expect.arrayContaining(['app/설정/page.tsx','app/pricing/page.tsx']));
    expect(inferRoutes(result.files).map(r=>r.route).sort()).toEqual(['/pricing','/설정']);
  });
  it.skipIf(process.platform === 'win32')('preserves whitespace, quotes, backslashes and line boundaries without trimming', () => {
    const f=fixture();
    const names=[' leading.tsx','trailing.tsx ','two words.tsx','tab\tname.tsx','line\nbreak.tsx','quote"name.tsx','back\\slash.tsx'];
    f.add(names);
    expect(changedFiles({cwd:f.cwd,baseRef:f.base}).files.sort()).toEqual([...names].sort());
  });
  it('uses the same lossless parsing for unrelated-history direct fallback', () => {
    const f=fixture();
    f.git('checkout','--quiet','--orphan','unrelated');
    const names=['app/설정/page.tsx','two words.tsx',...(process.platform==='win32'?[]:['tabs\tand\nlines.tsx',' trailing '])];
    f.add(names);
    const result=changedFiles({cwd:f.cwd,baseRef:f.base,headRef:'HEAD'});
    expect(result.range).toBe(`${f.base}..HEAD`);
    expect(result.warning).toContain('used a direct diff');
    expect(result.files.sort()).toEqual(names.sort());
    expect(inferRoutes(result.files).map(r=>r.route)).toContain('/설정');
  });
  it('selects only the changed Korean React Router component', () => {
    const f=fixture(); f.add(['src/pages/설정.tsx']);
    const routes=inferRoutes(changedFiles({cwd:f.cwd,baseRef:f.base}).files,{gitPaths:true,routerRoutes:[
      {route:'/settings',component:'설정',file:'src/App.tsx'},
      {route:'/help',component:'도움말',file:'src/App.tsx'},
    ]});
    expect(routes.map(r=>r.route)).toEqual(['/settings']);
  });
  it('does not match empty component keys and preserves Windows-style API inputs', () => {
    expect(inferRoutes(['src/pages/---.tsx'],{routerRoutes:[{route:'/wrong',component:'___',file:'src/App.tsx'}]}).map(r=>r.route)).not.toContain('/wrong');
    expect(inferRoutes(['app\\settings\\page.tsx']).map(r=>r.route)).toEqual(['/settings']);
  });
  it.skipIf(process.platform === 'win32')('does not invent slash directories from Git literal backslashes', () => {
    const f=fixture(); f.add(['app\\settings/page.tsx','app/pricing/page.tsx']);
    const routes=inferRoutes(changedFiles({cwd:f.cwd,baseRef:f.base}).files,{gitPaths:true});
    expect(routes.map(r=>r.route)).toEqual(['/pricing']);
  });
  it.skipIf(process.platform === 'win32')('escapes terminal controls but preserves JSON filenames', async () => {
    const f=fixture(); f.add(['app/evil\x1b[2J\u009b/page.tsx']);
    for(const json of [false,true]) {
      const lines:string[]=[];
      await runCli(['routes','--base-ref',f.base,...(json?['--json']:[])],{cwd:f.cwd,stdout:l=>lines.push(l)});
      const text=lines.join('\n'); expect(text).not.toContain('\x1b'); if(!json) expect(text).not.toContain('\u009b');
      if(json) expect(JSON.parse(text).files).toEqual(['app/evil\x1b[2J\u009b/page.tsx']);
    }
  });
  it.skipIf(process.platform === 'win32')('captures the actual tab-named static page through Git inference', async () => {
    const f=fixture(); f.add(['team\tupdates/index.html']);
    const outcome=await runCompare({cwd:f.cwd,base:f.cwd,head:f.cwd,baseRef:f.base,
      outDir:join(f.cwd,'artifacts'),viewports:[{name:'small',width:400,height:400}],
      observer:{beforeScreenshot:async page=>{expect(await page.locator('body').textContent()).toContain('export default');}},
    });
    expect(outcome.stats.errors).toBe(0);
    expect(outcome.results.map(r=>r.route)).toEqual(['/team%09updates']);
  },30000);
  it('returns no phantom file for an empty diff and keeps revision helpers trimmed', () => {
    const f=fixture();
    expect(changedFiles({cwd:f.cwd,baseRef:f.base}).files).toEqual([]);
    expect(revParse(f.cwd,'HEAD')).toBe(f.base);
    expect(shortSha(f.cwd,'HEAD')).toMatch(/^[a-f0-9]{4,}$/);
  });
  it('keeps the missing-ref warning without throwing', () => {
    const f=fixture();
    const result=changedFiles({cwd:f.cwd,baseRef:'no-such-ref'});
    expect(result.files).toEqual([]);
    expect(result.warning).toContain('could not read git diff');
  });
});
