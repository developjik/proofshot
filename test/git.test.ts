import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFiles, revParse, shortSha } from '../src/git';
import { inferRoutes } from '../src/routes';

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
  it('preserves whitespace, quotes, backslashes and line boundaries without trimming', () => {
    const f=fixture();
    const names=[' leading.tsx','trailing.tsx ','two words.tsx','tab\tname.tsx','line\nbreak.tsx','quote"name.tsx',...(process.platform==='win32'?[]:['back\\slash.tsx'])];
    f.add(names);
    expect(changedFiles({cwd:f.cwd,baseRef:f.base}).files.sort()).toEqual([...names].sort());
  });
  it('uses the same lossless parsing for unrelated-history direct fallback', () => {
    const f=fixture();
    f.git('checkout','--quiet','--orphan','unrelated');
    f.add(['app/설정/page.tsx','tabs\tand\nlines.tsx',' trailing ']);
    const result=changedFiles({cwd:f.cwd,baseRef:f.base,headRef:'HEAD'});
    expect(result.range).toBe(`${f.base}..HEAD`);
    expect(result.warning).toContain('used a direct diff');
    expect(result.files.sort()).toEqual(['app/설정/page.tsx','tabs\tand\nlines.tsx',' trailing '].sort());
    expect(inferRoutes(result.files).map(r=>r.route)).toContain('/설정');
  });
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
