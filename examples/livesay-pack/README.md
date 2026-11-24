# Local visual and announcement evidence pack

Opt-in example for DEV-70. It uses the existing proofshot SceneSpec, not a new
scene language, and the livesay probe/audit/compareReports APIs from DEV-67.
No new package dependency, publication, deployment or PR comment posting.

## Reproduce the synthetic sample

Build this checkout with `npm ci && npm run build`. Separately build a clean
livesay checkout at `3cf310a667fff3047114fad12324300616b64045` with
`npm ci && npm run build`. Install Playwright Chromium, then run:

```sh
node examples/livesay-pack/sample.mjs /absolute/livesay/dist/index.js ./livesay-pack-out
node examples/livesay-pack/test.mjs /absolute/livesay/dist/index.js ./livesay-pack-out/rerun-config.json
```

The sample creates a disposable local git repository with base/head commits,
serves its synthetic static builds on loopback, and runs the same click/wait
scene on both. It changes both visible result text and the live-region message.
Open `index.html` through any local static server. `pr-comment.md` is a proposed
comment, not a posted comment. Links are artifact-relative: upload the full
folder together or substitute reviewed artifact URLs before posting yourself.
No GitHub token or API key is needed. Sample content has no private data.

For your own **trusted local synthetic** static builds, supply a JSON manifest
with `base`, `head` (absolute build directories), `baseCommit`, `headCommit`
(full git HEAD SHAs), `out` (new/empty directory), `scenes` (SceneSpec array),
optional `params` for route substitution, optional `graceMs`, and optional `viewport` (`name`, `width`, `height`). Then run:

```sh
node examples/livesay-pack/run.mjs manifest.json /absolute/livesay/dist/index.js
```

Do not use private, untrusted or network-connected apps. Although browser
requests are restricted to loopback and WebSockets/popup pages are closed, this
is not a security sandbox. Loopback apps can have their own side effects.
Inputs must have clean tracked git state. Build bytes are hashed before and
after; untracked build outputs are permitted but independently bound by hashes.
Symlink build roots/entries and non-regular files are rejected. Build input is
bounded to 1,000 files of at most 8 MiB each. Output must not overlap a build and
must be empty. The livesay module path is explicitly trusted executable code,
not an untrusted report. No shell command is assembled from manifest text.

## What is bound and collected

- One screenshot page per scene/side/viewport. The probe attaches **before
  navigation on that same page**, the existing scene steps run, a new scene answer end
  is awaited with no running answers and a configurable grace period (default
  1,200 ms, range 1,200–5,000 ms), then the screenshot and DOM accessibility result are captured.
- Exact normalized scene/steps hash, viewport hash, git base/head IDs, input
  content hashes in the pack and each announcement JSON binding, tool versions
  and original report links are preserved. Announcement HTML and original
  visual/DOM reports do not embed the binding: keep evidence-pack.json and the
  JSON sidecars with them, not isolated HTML files.
- Base/head announcement transcripts and existing livesay regression metrics
  are shown together. This does not add a competing regression judge.
- Missing probe, missing answer-end marker, empty recording or blocked scene is
  `unverified`, never an empty passing announcement transcript. JSON/Markdown
  still record the failure. A capture failure does not erase other scene results.
- Collection status `verified` means both evidence sources were collected and
  bound, not that accessibility passed. Inspect original findings and DOM deltas.
- This is a simulated `nvda-like` announcement contract. It is not an actual
  screen reader, cross-AT compatibility guarantee or WCAG certification.

The optional `CaptureObserver` API is additive. No observer means the existing
CLI, default capture and package behavior are unchanged. Observer exceptions
fail that capture; the example handles announcement-only failures separately
so a usable visual report can remain with explicit unverified status.

## Evidence and tests

The synthetic sample exercises base/head screen and transcript changes. Negative
checks also cover stale previous answer markers, delayed completion messages,
comparison failure, one-sided original preservation and route parameters. They cover mismatched scene/steps/viewport/commit binding, absent announcements,
blocked capture, wrong HEAD and output/input overlap. The integration workflow
pins a livesay commit, runs sample plus negative checks, and retains complete
artifacts for seven days even when a check fails. Existing proofshot tests and
Node 20 package checks remain separate and unchanged.

DEV-46 terminal announcement fix and DEV-47 static-server root isolation are
present in the pinned source versions. Do not replace those sources with older
unchecked versions. Public documentation: https://github.com/developjik/livesay
