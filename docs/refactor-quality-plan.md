# Cardnews Foundry — 리팩토링 + 출력 퀄리티 증강 실행 계획

실행자: 코딩 에이전트 (계획 수립 시점 기준 HEAD = `62b3453`, 트리 클린, `tsc --noEmit` 0)


## 실행 결과 (2026-07-30 업데이트)

- **DONE** R1 `c96b0ad` · R2 `4daa2fd` · R3 `7684b19` · R4(워크스페이스 위생, 레포 밖) · Q1 `a4a8ea1` · Q2 `2f40a9f` · Q3 `5adec4c` · Q4 `d125f35`
- 검증: fix-loop 6/6, card-geometry 10/10, renderer 11/11, gate-matrix 52/52, contracts 19/19, precondition 3/3, 빠른 스위트 106/106, `tsc --noEmit` 0. 트리 클린.
- **Q4 결론(렌더-리뷰 루프 수행됨)**: 렌더해 보니 주관 건이 아니라 **객관적 대비 버그**였다 — ink-paper의 어두운 잉크 텍스트가 brightness(.32)로 죽인 이미지 위에 올라가 over-background 헤드라인/본문이 사실상 판독 불가(AA 실패). frozen fixture에 배경 카드가 없어 이 경로가 육안 검증된 적이 없었음. 수정: 테마-canvas 스크림(`--background-scrim`, 90/62/92% 세로 베일) + brightness(.85). **함정 기록**: 커스텀 프로퍼티는 요소별 computed 시점에 내부 `var()`를 즉시 해석하므로 `:root`에 선언하면 테마 블록의 `--color-canvas`가 안 보여 guaranteed-invalid로 죽는다 → 반드시 두 `[data-theme]` 블록 안에 선언.
- **HOLD** Q5 — 별도 승인 대기.
## 0. 컨텍스트 (이미 끝난 것 — 다시 하지 말 것)

- 렌더 중간 HTML 미보존(`retainHtml` 기본 off), `cardnews prune` + package 후 auto-prune — 커밋 `62b3453`에 포함.
- Codex의 미완성 "QA evidence retention/storage" 에픽은 전부 제거됨. 부활시키지 말 것.

## 1. 함정 목록 (이 레포에서 에이전트가 죽는 지점)

1. **소스 스캔 가드**: `test/render/fix-loop.test.mjs`가 `src/render/card.mjs` **파일 내용 자체**를 정규식으로 검사한다 — 한글 문자 금지, card-id 분기 금지. card.mjs에 한글 리터럴(정규식 포함)을 넣으면 즉사.
2. **토큰 강제 CSS**: 렌더 CSS에 raw 수치/색상 리터럴 금지(같은 테스트의 token-bound 스캔). 모든 값은 `design.mjs`/`themes`의 CSS 변수로만. 새 CSS는 반드시 토큰을 `designTokens`/테마에 선언하고 `var()`로 소비.
3. **`exactOptionalPropertyTypes: true`**: optional 프로퍼티에 `undefined` 명시 대입 불가. 조건부 스프레드(`...(x === undefined ? {} : { x })`) 사용.
4. **제한된 node shim**: `src/*/node-builtins.d.ts`가 fs API를 부분 선언. shim에 없는 API(예: `Stats.size`, `readdir withFileTypes`)를 쓰면 tsc 실패. 필요하면 shim에 선언 추가.
5. **hermetic 렌더**: 브라우저는 `page.setContent(인라인 HTML)` + 전 요청 `route.abort`. 외부 URL/파일 참조는 `NETWORK_REQUEST_BLOCKED`로 즉사. 폰트/이미지는 data URI 인라인 유지.
6. **결정성/불변성 계약**: 렌더 출력은 immutable(`OUTPUT_IMMUTABLE`), CSS 변경은 PNG 바이트를 바꾸므로 **같은 잡 재렌더 불가 → 새 리비전으로 렌더**. run-to-run 결정성 테스트(동일 입력 2회 = 동일 해시)는 CSS 변경과 무관하게 통과해야 함.
7. **테스트 러너**: `node --test --test-concurrency=1`. 렌더 계열은 Playwright Chromium 실행이라 파일당 수 분. 인내심 필요, 타임아웃 넉넉히.

## 2. 트랙 R — 리팩토링 (순서대로, 페이즈당 커밋 1개)

### R1. RED 소거: `headlineScript`를 `korean.mjs`로 이동
- 현상: `src/render/card.mjs:34`의 `/[가-힣]/u` 정규식 리터럴이 가드 1을 오탐시켜 fix-loop 테스트가 baseline부터 RED.
- 작업: `headlineScript` 함수를 `src/render/korean.mjs`로 이동(한글 도메인 공인 모듈), card.mjs는 임포트. 동작 변화 0.
- 검증: `node --test test/render/fix-loop.test.mjs` 전부 그린 + `node --test --test-concurrency=1 test/render/renderer.test.mjs` 11/11.

### R2. 죽은 T12 잔재 삭제
- 대상: `scripts/finalize-t12-evidence.mjs`, `scripts/finalize-t12-a3-evidence.mjs`, `scripts/visual-pass-retention.mjs` (t12-a3만 소비).
- 사전 확인: 삭제 전 `grep -r "finalize-t12\|visual-pass-retention" scripts test src .github package.json` 재확인(상대 임포트 포함).
- 검증: `corepack pnpm test` + `corepack pnpm test:package` 그린.

### R3. node-builtins shim 4벌 → 1벌
- `src/{assets,contracts,ingest,jobs}/node-builtins.d.ts`의 합집합을 `src/types/node-builtins.d.ts` 하나로 통합, 4벌 삭제.
- 검증: `corepack pnpm typecheck` exit 0. (선언 파일 전용 — 런타임 무영향)

### R4. 워크스페이스 위생 (레포 아님)
- `~/cardnews-workspace/.cardnews/jobs/*/package/` 안의 수동 언팩 디렉토리와 `.DS_Store` 제거. zip이 canonical.

## 3. 트랙 Q — 출력 카드뉴스 퀄리티 증강 (효과/리스크 순)

### Q1. 정밀 한글 조판 (리스크 최소, 체감 큼)
- `text-wrap: balance`를 headline h1에 (2줄 헤드라인의 마지막 단어 고아 방지).
- `font-variant-numeric: tabular-nums`를 `.stat-value`에 (숫자 정렬 — Q3와 시너지).
- `text-spacing-trim`(CJK 구두점 트리밍)을 본문/헤드라인에.
- **주의**: 전부 `design.mjs`의 토큰/시스템 CSS 경유(가드 2). 키워드 값이라 수치 리터럴 스캔은 통과.
- **사전 프로브**: 고정 Chromium이 세 속성을 지원하는지 1페이지 프로브로 확인 후 적용(`CSS.supports` 평가). 미지원 속성은 무해하게 무시되지만 확인 기록을 남길 것.
- 검증: `test:render` 풀런(geometry gate가 조판 변화로 인한 충돌/오버플로를 자동 검출) + 새 리비전 렌더 후 contact-sheet 육안 확인.

### Q2. 에디토리얼 린트 게이트 (싸고, 슬롭 방지)
- `evaluate`의 결정성 게이트에 storyboard 검사 추가: 헤드라인 글자수 상한, 카드당 문장 수 상한(한 카드 한 논지), 7장 간 첫 어절 중복 금지, `stat`/`diagram` 카드는 숫자 포함 필수.
- 전부 오프라인·결정성 — LLM 불필요. 기존 gate matrix 패턴(`src/evaluate/source-gates.mjs` 참고) 그대로.
- 검증: gate-matrix 테스트에 위반 픽스처 추가, `test:evaluate` 그린.

### Q3. `stat` 컴포지션 production 배선 (중간 리스크, 다양성 큼)
- 현상: `stat-block` 프리미티브가 디자인 시스템(DESIGN.md §5, CSS 토큰)에 완비돼 있으나 `card.mjs`의 `composition()` switch에 없음 — production 컴포지션은 headline/split/quote/diagram/closing 5종뿐.
- 작업: `composition()`에 `"stat"` 케이스 추가(`.stat-block`: `recipeCard.emphasis[0]`=값, `[1]`=라벨), visual-recipe 스키마의 composition enum에 `stat` 추가, 픽스처에 stat 카드 1장 반영.
- **주의**: 스키마 변경은 `schemas/visual-recipe.schema.json` + 계약 벡터 갱신 필요. card.mjs에 한글 리터럴 금지(가드 1) — 라벨 텍스트는 전부 recipe 데이터에서.
- 검증: `test:contracts` + `test:render` 풀런.

### Q4. 배경 이미지 스킴 개선 (HOLD — 시각 재디자인, 실제 렌더 리뷰 필요)
- 현상: 배경 미디어에 전역 `brightness(.32) saturate(.9)` (design.mjs `--background-image-filter`) — 이미지가 죽는다.
- **실행 중 발견(중요)**: 배경 카드 CSS(`.background-media`, `.closing-statement[data-state="over-background"]`, `filter:var(--background-image-filter)`)는 **card.mjs 내부 `<style>` 블록**에 있어 fix-loop 토큰 스캔 대상 — 그라디언트 stop 같은 raw 값은 design.mjs 토큰(`--background-scrim` 등)으로 정의하고 card.mjs는 `var()`만 참조해야 함(design.mjs는 스캔 예외).
- **핵심 트레이드오프**: `over-background` closing 카드는 **헤드라인(display)까지 이미지 위에 직접** 올라간다(`body[data-state="on-background"]`만 불투명 canvas 스트립으로 대비 보장). 밝기를 풀면 상단 헤드라인 대비가 깨질 수 있어 **하단 가중 스크림 하나로는 불충분** — 헤드라인 위치까지 커버하는 스크림/불투명 스트립 설계가 필요.
- 그래서 이건 기계적 변경이 아니라 **주관적 시각 결정** = 실제 카드 렌더를 사람이 보며 반복해야 함. 테스트는 안전성(geometry gate)만 검증하지 미학/대비 균형은 못 함.
- 안전망 옵션(스킴 완화 시): 최종 PNG의 텍스트 rect 픽셀을 샘플해 AA(4.5:1) 미달 시 fail하는 컨트라스트 게이트. 단 deviceScaleFactor↔픽셀 매핑·결정성 확보가 별도 과제.
- 검증: 컨트라스트 게이트 그린 + **새 리비전 렌더 육안 before/after 비교(승인 게이트)**.

### Q5. (선택 — 별도 승인 후) 2× 해상도 타겟
- `deviceScaleFactor: 2` 또는 2160×2700 타겟 프로파일 — IG 재압축 내성↑. 단 `RenderArtifact`의 width/height 검증·계약 다수 접촉 → 승인 없이 착수 금지.

### 명시적 비목표
- 폰트 서브셋팅(45MB 인메모리 HTML 축소): `fontDigests`가 계약에 박혀 결정성 재설계 필요 — 별도 프로젝트.
- 공유 에셋 스토어, TS/MJS 통일: 실익 대비 churn 큼.

## 4. 실행 규칙

1. 페이즈당 커밋 1개, 커밋 전 해당 페이즈 검증 명령 필수 실행.
2. R1→R2→R3→Q1→Q2→Q3→Q4 순서. Q5는 별도 승인.
3. 건드리지 말 것: `src/contracts/` 기존 스키마의 기존 필드, determinism 벡터의 기존 해시(신규 추가만 허용), `.omo`/`.omx`/`.openchrome`.
4. 전체 완료 후 `corepack pnpm test:all` 1회 풀런(수십 분 소요 — 정상).
5. 카피/이미지 소재 자체의 품질은 업스트림(skill 프롬프트) 소관 — 이 계획은 조판·컴포지션·게이트로 하한선을 올리는 것.
