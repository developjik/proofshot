# Changelog

## 0.1.1

- `init`: the generated PR workflow now runs `npx -y @developjik/proofshot@latest` — the scoped package (unscoped `proofshot` on npm is somebody else's). Regenerate existing workflows with `proofshot init --force` (DEV-36).
- `serve`: static server no longer follows symlinks that escape the served root — candidates are resolved with `realpath` and must stay inside the root, so linked-out files and directories return 404/SPA fallback instead of their contents (DEV-47).
- Docs: README (en/ko) workflow section updated for the scoped package name.

## 0.1.0

- Initial release: `proofshot compare` (screenshot + pixel diff + a11y delta), `proofshot init` PR workflow, route inference, markdown report.
