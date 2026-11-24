# proofshot

[English](README.md) · 한국어

[![CI](https://github.com/developjik/proofshot/actions/workflows/ci.yml/badge.svg)](https://github.com/developjik/proofshot/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@developjik/proofshot.svg)](https://www.npmjs.com/package/@developjik/proofshot)
[![node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**Storybook 없이, 풀 리퀘스트를 위한 전후 스크린샷·픽셀 비교·접근성 델타.**

에이전트가 작성한 PR은 빠르게 움직이고 자기 설명은 산문으로 합니다. 그런데 리뷰어는 UI 변경에서 정말 중요한 단 하나의 질문에 여전히 답해야 합니다: *지금 어떻게 보이고, 무엇이 나빠졌나?* proofshot은 그 답을 증거로 냅니다. 스토리를 만들지도, 계정을 요구하지도 않으며, PR 하나를 바뀐 화면 표로 바꿔 전후 이미지, diff PNG, 그 변경이 새로 만든 a11y 문제를 함께 보여줍니다.

- **설정 제로.** 빌드 디렉터리 두 개 또는 URL 두 개를 가리키면 끝입니다. 라우트는 diff에서 추론합니다(`next-app`, `next-pages`, `react-router`, Vite/SPA, 정적 HTML).
- **실제 스크린샷.** Playwright가 데스크톱·모바일 폭에서 모든 라우트를 전체 페이지로 캡처합니다.
- **느낌이 아니라 픽셀 비교.** `pixelmatch`가 변경 픽셀 비율을 보고하고 diff PNG를 씁니다.
- **접근성 델타.** 가벼운 DOM 검사기가 무엇이 나빠졌는지 보고합니다(alt 누락, 이름 없는 버튼/링크, 레이블 없는 필드, 제목 단계 건너뜀, 중복 id, 랜드마크 또는 `lang` 누락, 새 콘솔 에러) — 전후 **모두** 보므로 회귀를 추측하지 않고 이름으로 지목합니다.
- **그대로 붙일 수 있는 PR 코멘트.** `report.md`가 안정적인 마커로 시작하므로 워크플로가 새 코멘트를 쌓지 않고 이전 코멘트를 수정합니다.

### Storybook + Chromatic은 왜 안 되나?

| | proofshot | Storybook + Chromatic | 코드 diff 리뷰 도구 (hunk, crit) |
| --- | --- | --- | --- |
| 설정 | 빌드/URL 두 개를 가리키면 끝, 라우트는 diff에서 추론 | 모든 상태마다 스토리를 작성·유지 | 없음 |
| 리뷰어가 보는 것 | PR이 건드린 라우트의 **실제 앱 화면** | 손으로 쓴 컴포넌트 스토리 | 소스 diff만 |
| a11y | 라우트별 전후 문제 델타, 외부 서비스 불필요 | 애드온/axe, 별도 리포팅 | 없음 |
| 비용 / 계정 | MIT, 로컬, 계정 불필요 | 유료 SaaS, 스냅샷 과금 | 로컬 |
| 결과 위치 | `report.md` + 아티팩트, PR 코멘트로 바로 게시 | 호스팅된 비주얼 리뷰 UI | 터미널 / PR |

이 도구가 메우는 간극: PR이 페이지 하나와 스타일시트를 건드리는데 그 페이지에는 스토리가 없습니다. proofshot은 PR이 실제로 바꾼 것을, 스토리를 쓸 필요 없이 스크린샷으로 찍습니다.

## 퀵스타트

> **상태: 초기 MVP, npm 배포 중.** [`@developjik/proofshot`](https://www.npmjs.com/package/@developjik/proofshot)으로 설치하세요 — `@developjik` 스코프를 꼭 붙이세요. 스코프 없는 `proofshot`은 이름만 같은 타인의 패키지입니다.

```bash
# 클론 없이 npm에서
npx -y @developjik/proofshot compare --base ../main/dist --head ./dist

# 또는 체크아웃에서 (npm install이 dist/도 빌드합니다)
git clone https://github.com/developjik/proofshot && cd proofshot
npm install && node dist/bin/cli.js compare --base ./demo/before --head ./demo/after --routes /,/pricing
```

아래 명령은 모두 같은 플래그를 받으므로, 쓰는 진입점을 앞에 붙이면 됩니다(`npx -y @developjik/proofshot` 또는 `node dist/bin/cli.js`).

```bash
# 두 빌드 비교 (proofshot이 두 디렉터리를 직접 서빙)
proofshot compare --base ../main-dist --head ./dist --out proofshot-out

# 또는 실행 중인 URL 두 개
proofshot compare --base-url http://localhost:3000 --head-url http://localhost:3001

# 일부 라우트만, 뷰포트 하나, 변경이 있으면 실패
proofshot compare --base ./before --head ./after \
  --routes /,/pricing --viewports desktop --fail-on change

# 이 diff에서 무엇을 캡처할지
proofshot routes --base-ref origin/main --head-ref HEAD

# 풀 리퀘스트 워크플로 추가
proofshot init
```

`proofshot-out/report.md`를 여세요. `demo/`의 데모 픽스처로 만든 `examples/report.md`에서는 이렇게 보입니다:

```markdown
## 📸 proofshot

**1 changed · 1 unchanged · 0 failed** · **1 a11y regression** — `demo/before` → `demo/after`

| Route | Viewport | Pixel diff | a11y | Console | Status |
| --- | --- | --- | --- | --- | --- |
| `/` | desktop | **2.32%** | ⚠️ +4 | 0 → 1 | 🔴 changed |
| `/pricing` | desktop | **0%** | ✅ 0 | 0 | 🟢 unchanged |

**New issues**
- `img-alt` `section.hero > div.shot-row > img:nth-of-type(1)` — image has no alt attribute
- `button-name` `section.hero > div.actions > button.icon-only` — button has no accessible name
- `heading-order` `main > section.logos > h3` — heading jumps from h1 to h3
- `console-error` `console` — Acme Studio: GET /api/tokens returned 500
```

바뀐 행마다 접힌 증거 섹션에 before / after / diff 이미지 표가 붙습니다. 커밋된 예시는 [`examples/report.md`](examples/report.md)에 있습니다.

## 라우트 추론

흔한 구조는 설정이 필요 없습니다. `proofshot routes --files <list>`는 무엇을 왜 캡처할지 그대로 출력합니다.

| 구조 | 바뀐 파일 | 캡처되는 라우트 |
| --- | --- | --- |
| Next.js App Router | `src/app/dashboard/page.tsx` | `/dashboard` |
| Next.js App Router (그룹 / 동적) | `src/app/(marketing)/blog/[slug]/page.tsx` | `/blog/[slug]` |
| Next.js Pages Router | `pages/blog/[slug].tsx` | `/blog/[slug]` |
| React Router | `src/pages/Pricing.tsx` (`<Route path="/pricing">`로 렌더됨) | `/pricing` |
| React Router (정의 변경) | `src/App.tsx` | 그 파일이 선언하는 모든 라우트 |
| Vite / SPA | `src/pages/UserSettings.tsx`, `src/App.tsx` | `/user-settings`, `/` |
| 정적 HTML | `pricing/index.html` | `/pricing` |
| 스타일시트 | `src/app/globals.css` | `/` (설정에 라우트를 적어 넓힘) |

경험칙:

- `app/**`는 항상 Next.js App Router로 읽습니다.
- `src/pages/**`는 그 컴포넌트를 렌더하는 라우트가 있으면 React Router, 리포에 Next(`next.config.*`, `pages/_app.*` 또는 `next` 의존성)가 있으면 Next.js Pages Router, 그 밖에는 Vite pages 폴더로 읽습니다.
- 테스트, 스토리, 문서, 락파일, 빌드 산출물은 절대 라우트를 만들지 않습니다.
- 동적 세그먼트는 글자 그대로 유지되고(`/blog/[slug]`), 설정의 `params`로 채워집니다.

### `.proofshot.json`

모두 선택 사항입니다. 이 파일은 덮어쓰기 용도로만 존재합니다.

```json
{
  "base": "../main-build/dist",
  "head": "./dist",
  "routes": ["/", "/pricing", "/blog/[slug]"],
  "params": { "slug": "hello-world" },
  "viewports": [
    { "name": "desktop", "width": 1280, "height": 800 },
    { "name": "mobile", "width": 390, "height": 844 }
  ],
  "threshold": 0.1,
  "fullPage": true,
  "settleMs": 400,
  "a11y": true,
  "outDir": "proofshot-out"
}
```

## a11y 델타가 검사하는 것

DOM만 쓰는 검사기입니다(axe 의존성 없음, 브라우저 확장 없음):

| 규칙 | 보고 내용 |
| --- | --- |
| `img-alt` | `alt`가 없는 보이는 `<img>` / `input[type=image]` (장식용 `alt=""`와 `role=presentation`은 허용) |
| `button-name` | 접근 가능한 이름이 빈 `<button>` 또는 `role=button` |
| `link-name` | 텍스트, 레이블, title, 이미지 alt가 없는 `<a href>` |
| `input-label` | `<label>`, `aria-label`, `aria-labelledby`, `title`이 모두 없는 폼 필드 |
| `heading-order` | 제목 단계가 한 단계 넘게 뛰는 경우 (h1 → h3) |
| `duplicate-id` | 같은 `id`가 두 번 이상 사용됨 |
| `landmark-main` | `<main>` / `role=main` 없음 |
| `html-lang` / `page-title` | 문서 언어 또는 제목 누락 |
| `console-error` | 새 `console.error` / 처리되지 않은 예외 메시지 |

문제는 규칙 + 셀렉터 + 세부 내용으로 키가 잡히므로 델타가 정확합니다: *새* 문제는 이름으로 지목하고, *고쳐진* 문제는 개수로 셉니다. 표에는 순변화가 나오고(`⚠️ +4`, `🎉 −1`, `✅ 0`), 각 캡처는 원시 개수를 나열합니다(`images 1 · buttons 1 · links 0 · fields 0 · headings 1 · console 1`).

## PR 워크플로

```bash
proofshot init          # .github/workflows/proofshot.yml 작성
```

생성된 워크플로는 `npx -y @developjik/proofshot@latest`로 proofshot을 실행합니다 — 스코프 패키지가 필요합니다(스코프 없는 `proofshot`은 타인의 패키지). proofshot ≤ 0.1.0으로 `.github/workflows/proofshot.yml`을 생성했다면 `proofshot init --force`로 다시 생성하거나 `npx` 줄을 직접 `@developjik/proofshot@latest`로 고치세요. PR head와 베이스 커밋을 (`git worktree`로) 빌드하고, `proofshot compare --base ../proofshot-base/dist --head ./dist`를 실행하고, 증거 폴더를 아티팩트로 업로드하며, `report.md`를 다음 명령으로 게시합니다:

```bash
gh pr comment "$PR" --body-file proofshot-out/report.md --edit-last --create-if-none
```

그래서 PR에는 항상 최신 proofshot 코멘트 하나만 붙습니다. 두 빌드 출력 경로와 `ROUTES` 환경값은 앱에 맞게 조정하세요.

## CLI

```
proofshot compare --base <dir|url> --head <dir|url> [options]
proofshot routes [--base-ref main] [--head-ref HEAD] [--files a,b] [--json]
proofshot init [--force]
```

| 옵션 | 의미 |
| --- | --- |
| `--base`, `--head` | 캡처할 빌드 디렉터리 또는 URL (`--base-url` / `--head-url`은 별칭) |
| `--routes` | 쉼표로 구분한 라우트, 추론을 건너뜀 |
| `--base-ref`, `--head-ref` | 라우트 추론에 쓰는 git 범위 (기본 `origin/main...HEAD`) |
| `--threshold` | 변경으로 인정하는 변경 픽셀 비율 (기본 `0.1`) |
| `--viewports` | `desktop,mobile` 또는 `phone=390x844` (기본 데스크톱 + 모바일) |
| `--full-page`, `--no-full-page` | 전체 페이지 스크린샷 (기본 켜짐) |
| `--settle` | 로드 후 스크린샷 전까지 대기할 밀리초 (기본 `400`) |
| `--a11y`, `--no-a11y` | 접근성 델타 켜기/끄기 (기본 켜짐) |
| `--fail-on change,a11y,error` | 해당 항목이 하나라도 있으면 종료 코드 `1` |
| `--json` | stdout으로 기계 판독 가능한 리포트 |
| `--out` | 출력 디렉터리 (기본 `proofshot-out`) |

종료 코드: `0` 리포트 작성됨 · `1` 캡처 실패 또는 `--fail-on` 발동 · `2` 사용법 오류.

### 이미 있는 Chromium 사용하기

Playwright는 자체 브라우저를 내려받습니다(`npx playwright install chromium`). 환경에 이미 있으면 proofshot이 그것을 가리키게 하세요:

```bash
PROOFSHOT_CHROMIUM_PATH=/usr/bin/chromium npx -y @developjik/proofshot compare ...
```

## 무엇이 기록되는가

```
proofshot-out/
  report.md              # PR comment / artifact index
  report.json            # 같은 데이터, 기계 판독용
  base-<route>-<vp>.png  # before
  head-<route>-<vp>.png  # after
  <route>-<vp>-diff.png  # 픽셀이 바뀐 경우에만
```

`<route>`는 최대32자의 읽는 slug와 정규화 경로 SHA-256의128비트 접두 해시입니다.
`/`와 `/root`, 중첩 경로와 하이픈 경로, 한글 경로를 구별하며 경로 순서에 무관하게 안정적입니다.
파일명을 직접 만들지 말고 보고서에 기록된 이미지 경로를 사용하세요. 이 변경 후 기존 이미지는 다시 생성해야 합니다.

before/after/diff 이미지는 `report.md`에서 상대 이름으로 참조되므로 아티팩트만으로 완결됩니다. GitHub PR 코멘트는 아티팩트의 파일을 인라인으로 보여주지 못합니다 — 이미지를 열어야 한다면 아티팩트를 내려받거나 폴더를 커밋하세요.

## 동작 방식

1. **라우트** — `git diff` → `inferRoutes`(위의 프레임워크 휴리스틱), 또는 `.proofshot.json`.
2. **캡처** — Chromium 하나, 뷰포트마다 컨텍스트 하나, 양쪽 모든 라우트; 지연 콘텐츠는 뷰로 스크롤하고, 애니메이션은 끄고, `document.fonts.ready`를 기다립니다.
3. **비교** — `pngjs` + `pixelmatch`; 스크린샷 높이가 다르면 페이지 배경으로 채우고 표시합니다(`before 1280×1725 → after 1280×1860`).
4. **a11y** — 캡처마다 DOM 스냅샷, 양쪽 사이의 키 기반 문제 델타.
5. **리포트** — 요약 표와 바뀐 라우트마다 접힌 증거 섹션.

실행은 뷰포트별로 순차, 양쪽 사이는 병렬입니다.

## 한계

- a11y 검사기는 의도적으로 작습니다. UI PR이 가장 자주 만드는 문제를 잡으며, WCAG 감사가 아닙니다(대비, 포커스 순서, ARIA 유효성 없음). 전체 규칙 세트가 필요하면 axe와 함께 쓰세요.
- 라우트 추론은 정적입니다. 동적 표현식(`<Route path={route} ...>`), 커스텀 라우터, 모노레포 별칭은 `.proofshot.json`의 라우트가 필요합니다.
- 픽셀 비교는 폰트 렌더링과 OS에 민감합니다. 같은 것끼리 비교하세요(같은 컨테이너, 같은 브라우저 빌드) — 워크플로는 양쪽을 같은 러너에서 돌려 이 조건을 맞춥니다.
- 픽셀 변경 임계값은 수정과 회귀를 구분하지 못합니다. proofshot은 증거와 a11y 델타를 보여주고, 판단은 사람(또는 에이전트)이 합니다.
- 두 스크린샷 크기가 달라지면 채워 넣은 영역은 흰색입니다. 페이지가 커져서 위치만 옮겨진 콘텐츠도 변경으로 셉니다.

## 개발

```bash
npm install
npx playwright install chromium
npm run typecheck
npm test                 # 48 unit tests + Real Playwright E2E on demo/before vs demo/after
npm run build
npm run demo             # 픽스처로 proofshot-out/report.md 작성
```

E2E 스위트는 `demo/`를 상대로 실제 캡처/비교/a11y 파이프라인을 돌립니다 — 바뀌는 홈 페이지(새 히어로, 색, 아이콘 전용 버튼, alt 없는 이미지, 제목 단계 점프, 콘솔 에러)와 그대로인 pricing 페이지입니다. 바뀜/안 바뀜 구분, a11y 규칙 각각, diff 이미지, 리포트를 검증합니다.

MIT © [Jung Ingwon (developjik)](https://github.com/developjik)

## 선택적 axe-core 검사 (DEV-125)

실행할 프로젝트에 `npm install --save-dev axe-core`로 설치한 뒤 `proofshot compare --base dist-before --head dist-after --routes / --a11y axe --fail-on a11y`를 실행하세요. 기본은 off이며 옵션이 없으면 기존 경량검사와 보고서 출력은 그대로입니다. axe는 스크린샷 픽셀이 아니라 실제DOM에서 실행합니다.

report.json의 axe.regressions/existing/fixes와 PR코멘트 본문인 report.md에 신규/기존 위반, 규칙ID, 영향도, 셀렉터 경로를 기록합니다. 기준선에 없던 신규위반만 a11y 실패조건에 들어갑니다. 코멘트를 자동게시하지 않습니다. axe 미설치·지원불가·주입제한은 skip으로 표시하며 검사성공으로 간주하지 않습니다. 한쪽이 skip이면 기준선 차이를 판단하지 않습니다. 불확정 검사는 수동검토 수로 남깁니다. axe만으로 전체WCAG준수나 모든 키보드/포커스 동작을 보장하지는 않습니다. 프로그램 API는 runCompare({axe:true})를 사용합니다.

## 개발 기준선 (DEV-128)

개발과 CI는 Node.js 22.12.0(`.nvmrc`) 이상을 사용합니다. Vitest 5.1.1의 공식 지원 범위에는 Node 20.19가 없습니다. 실행이 된다는 이유로 공식 지원이라고 부르지 않습니다. 패키지 사용자의 기존 engines는 유지합니다. Node 20 지원 패키지는 테스트 러너 없이 빌드한 tarball의 운영 의존성만 설치하고 CLI/import를 별도로 검사합니다. 개발 TypeScript 기준은 7.0.2입니다.
