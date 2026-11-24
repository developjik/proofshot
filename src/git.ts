import { execFileSync } from "node:child_process";

export function runGit(args: string[], cwd: string): string | null {
  return gitOutput(args, cwd)?.trim() ?? null;
}

/** Filename output must bypass display quoting and preserve whitespace. */
function gitOutput(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

export interface ChangedFilesResult {
  files: string[];
  range: string;
  warning?: string;
}

/**
 * Files changed between two refs. Uses the merge base (`a...b`) so a stale
 * base branch does not report the base branch's own commits as changes.
 */
export function changedFiles(options: {
  cwd: string;
  baseRef?: string;
  headRef?: string;
}): ChangedFilesResult {
  const base = options.baseRef ?? "origin/main";
  const head = options.headRef ?? "HEAD";
  const range = `${base}...${head}`;

  const diff = gitOutput(["diff", "--name-only", "-z", "--diff-filter=ACMR", range], options.cwd);
  if (diff !== null) {
    return { files: splitPaths(diff), range };
  }

  const direct = gitOutput(["diff", "--name-only", "-z", "--diff-filter=ACMR", base, head], options.cwd);
  if (direct !== null) {
    return {
      files: splitPaths(direct),
      range: `${base}..${head}`,
      warning: `merge-base diff with ${base} failed; used a direct diff instead`,
    };
  }

  return {
    files: [],
    range,
    warning: `could not read git diff for ${range} in ${options.cwd}`,
  };
}

export function shortSha(cwd: string, ref: string): string | null {
  const sha = runGit(["rev-parse", "--short", ref], cwd);
  return sha && /^[0-9a-f]{4,}$/i.test(sha) ? sha : null;
}

export function revParse(cwd: string, ref: string): string | null {
  const sha = runGit(["rev-parse", ref], cwd);
  return sha && sha.length > 0 ? sha : null;
}

function splitPaths(value: string): string[] {
  // Git -z emits literal pathnames separated by NUL, never C-quoted lines.
  return value.split("\0").filter((path) => path.length > 0);
}
