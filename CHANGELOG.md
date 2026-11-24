# Changelog

## Unreleased

- Git changed-file discovery now reads NUL-delimited pathnames in both merge-base and direct fallback diffs, preserving Korean names, whitespace, tabs and newlines instead of passing display-quoted strings to route inference (DEV-158).

## 0.1.1

- `init`: the generated PR workflow now runs `npx -y @developjik/proofshot@latest` — the scoped package (unscoped `proofshot` on npm is somebody else's). Regenerate existing workflows with `proofshot init --force` (DEV-36).
- `serve`: static server no longer follows symlinks that escape the served root — candidates are resolved with `realpath` and must stay inside the root, so linked-out files and directories return 404/SPA fallback instead of their contents (DEV-47).
- Docs: README (en/ko) workflow section updated for the scoped package name; the remaining unscoped `npx proofshot` examples (Chromium override, workflow header comment) now use `@developjik/proofshot` too (DEV-36).
- `--version` reports the real version again — it looked for a `package.json` named `proofshot` and printed `0.0.0` after the rename to `@developjik/proofshot` (DEV-36).

## 0.1.0

- Initial release: `proofshot compare` (screenshot + pixel diff + a11y delta), `proofshot init` PR workflow, route inference, markdown report.
