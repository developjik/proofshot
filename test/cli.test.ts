import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";

const dirs: string[] = [];

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "proofshot-cli-"));
  dirs.push(dir);
  await mkdir(join(dir, "src/app/pricing"), { recursive: true });
  await writeFile(
    join(dir, "src/app/page.tsx"),
    "export default function Page() { return null; }\n",
  );
  await writeFile(
    join(dir, "src/app/pricing/page.tsx"),
    "export default function Page() { return null; }\n",
  );
  return dir;
}

function capture(): { lines: string[]; out: (line: string) => void } {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line) };
}

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("CLI", () => {
  it("prints help", async () => {
    const { lines, out } = capture();
    const code = await runCli(["--help"], { stdout: out, stderr: out });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("proofshot compare --base");
    expect(text).toContain("proofshot init");
    expect(text).toContain("--fail-on");
  });

  it("prints a version", async () => {
    const { lines, out } = capture();
    const code = await runCli(["--version"], { stdout: out, stderr: out });
    expect(code).toBe(0);
    expect(lines.join("")).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lines.join("").trim()).not.toBe("0.0.0");
  });

  it("rejects an unknown option", async () => {
    const { lines, out } = capture();
    const code = await runCli(["compare", "--nope"], {
      stdout: out,
      stderr: out,
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("unknown option --nope");
  });

  it("rejects an unknown command", async () => {
    const { lines, out } = capture();
    const code = await runCli(["nope"], { stdout: out, stderr: out });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain('unknown command "nope"');
  });

  it("infers routes from an explicit file list", async () => {
    const cwd = await tempProject();
    const { lines, out } = capture();
    const code = await runCli(
      ["routes", "--files", "src/app/page.tsx,src/app/pricing/page.tsx"],
      { cwd, stdout: out, stderr: out },
    );
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("2 route(s) from 2 changed file(s)");
    expect(text).toContain("/pricing");
    expect(text).toContain("next-app");
  });

  it("prints routes as JSON", async () => {
    const cwd = await tempProject();
    const { lines, out } = capture();
    await runCli(["routes", "--files", "src/app/pricing/page.tsx", "--json"], {
      cwd,
      stdout: out,
      stderr: out,
    });
    const parsed = JSON.parse(lines.join("\n")) as {
      routes: Array<{ route: string }>;
    };
    expect(parsed.routes.map((route) => route.route)).toEqual(["/pricing"]);
  });

  it("creates a workflow with init", async () => {
    const cwd = await tempProject();
    const { lines, out } = capture();
    const code = await runCli(["init"], { cwd, stdout: out, stderr: out });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain(
      "created .github/workflows/proofshot.yml",
    );
  });

  it("requires both sides for compare", async () => {
    const cwd = await tempProject();
    const { lines, out } = capture();
    const code = await runCli(["compare", "--base", "demo/before"], {
      cwd,
      stdout: out,
      stderr: out,
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("both sides are required");
  });
});

it("explicit configured routes bypass unsupported dynamic source scanning", async () => {
  const cwd = await tempProject();
  await writeFile(
    join(cwd, "src/App.tsx"),
    '<Route path={prefix}><Route path="settings" /></Route>',
  );
  await writeFile(
    join(cwd, ".proofshot.json"),
    JSON.stringify({ routes: ["/chosen"] }),
  );
  const { lines, out } = capture();
  expect(
    await runCli(["routes", "--json", "--files", "src/App.tsx"], {
      cwd,
      stdout: out,
      stderr: out,
    }),
  ).toBe(0);
  expect(lines.join("")).toContain("/chosen");
});
