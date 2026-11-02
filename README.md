# TriAI on Cloudflare Workers (서버 없는 TriAI)

파이 없이 Cloudflare 무료 플랜 안에서 TriAI 전체를 돌리는 판. 화면(`public/static/`)은 파이 때 코드 그대로이고, 백엔드만 TypeScript로 옮겼어요.
계획·범위: `../triai-app/docs/workers-migration.md`

## 폴더
```
src/index.ts     모든 주소(/gw/…, /api/…) · 로그인 문지기 · 스트리밍
src/chat.ts      질문 계획(분류·자동 선택·비용) → 여러 AI 동시 호출 → 저장
src/providers.ts Claude·GPT·Gemini·Cloudflare를 fetch+SSE로 (SDK 없음)
src/routing.ts   자동 모드 (키워드 분류 + 👍👎★ 승률)
src/history.ts   지난 대화 만들기·자르기 (요약 지문 검사 포함)
src/db.ts        D1 저장소 (대화·설정·사용량·업로드)
src/auth.ts      로그인·세션·사람 관리 (파이와 같은 PBKDF2 해시 → 기존 비밀번호 그대로)
migrations/      D1 스키마
tools/import.mjs 파이 백업 → import.sql
tools/smoke.sh · tools/ui_smoke.py  로컬 점검 (가짜 AI)
```

## 로컬에서 돌려보기 (요금 0)
```
npm install
cp .dev.vars.example .dev.vars          # 가짜 AI 모드
npx wrangler d1 migrations apply triai --local
npx wrangler dev                        # http://localhost:8787 → /gw/setup 에서 코드 TEST-CODE-1234 로 관리자 만들기
bash tools/smoke.sh && bash tools/smoke2.sh    # 다른 터미널에서 (가짜 AI로 전 기능 점검)
```

## 진짜 배포 (사용자가 직접 — 토큰·키는 사용자만)
```
npx wrangler login
npx wrangler d1 create triai            # → database_id 를 wrangler.jsonc 에 붙여넣기
npx wrangler kv namespace create KV     # → id 를 wrangler.jsonc 에 붙여넣기
npx wrangler d1 migrations apply triai --remote
npx wrangler secret put SESSION_SECRET  # 첫 관리자 만들 때 쓸 1회용 코드 (아무 글자)
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put CLOUDFLARE_API_TOKEN      # Workers AI 권한 토큰
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
# 선택: npx wrangler secret put TRIAI_GLOBAL_DAILY_LIMIT  (예: 3 → 하루 전체 $3)
#       npx wrangler secret put BRAVE_API_KEY            (있으면 검색이 안정적)
npx wrangler deploy                     # → https://triai-app.<계정>.workers.dev
```
옛 데이터 옮기기:
```
node tools/import.mjs "<백업>\files\home\pipi\triai" import.sql
npx wrangler d1 execute triai --remote --file=import.sql
```
(import.sql 안에 비밀번호 해시가 들어 있으니 올린 뒤 지우기)

## 되는 것 / 안 되는 것
되는 것: 로그인·계정·비밀번호 바꾸기, 채팅(4개 AI 동시 스트리밍, 사진), 자동 모드, 평가, 다른 AI에게 묻기, 종합, 대화 목록·검색·분기·내보내기·가져오기,
설정, 분류표, 기억(+제안), 하루 예산(사람별 + 전체), **긴 대화 자동 요약**, **아티팩트 보관함**, **공유 링크 /s/…**, **프리셋·모드·스타일**, **프로젝트(지침·지식 파일)**,
**웹검색(🌐)·심층 리서치(🔬)**, 차트(화면 쪽)
아직: 루틴(Cron), 봇·팀, 폰 알림 (3단계)
안 함: 카메라, 파이 상태판, 로컬 Ollama, MCP, 음성, 코드 실행, Google 연동

## 보안 (Cloudflare 구조에 맞게)
- 로그인: 같은 IP 10분에 5번 틀리면 잠금 + 10분에 10번 속도 제한 · 세션은 활동 없이 7일 지나면 만료, 비밀번호 바꾸면 모든 기기 로그아웃
- 요청: 분당 600회(일반) · 채팅류 분당 30회 · 공유 만들기 시간당 20회 · 공개 링크 분당 120회(IP) · 본문 6MB까지
- 관리자 전용 `/api/admin/*` · 데이터를 바꾸는 요청은 같은 사이트 + `X-TriAI` 헤더가 있어야 함(CSRF 차단)
- CSP: 화면은 외부 이미지·통신 금지(정보 유출 차단), 아티팩트·공유 창은 격리(sandbox, connect-src 'none')
- 예산: 사람별 하루 한도 + `TRIAI_GLOBAL_DAILY_LIMIT`(계정 전체 하루 상한, 선택)
- 감사 기록: 로그인 성공/실패·관리자 작업·비밀번호 변경·공유 생성이 IP·시각과 함께 남고 `/gw/admin`에서 보임
- 선택: Cloudflare Access(Zero Trust, 50명까지 무료)를 앞에 두면 이메일 인증 없이는 로그인 화면조차 안 보임

## 내 컴퓨터 기능 (서버 없는 구조)
- 코드 실행: 브라우저 격리 상자(Pyodide). 설정 → 도구
- 내 컴퓨터 도구: 윈도우 TriAI 앱으로 이 주소를 열면 켜짐
- 연결(MCP): 설정 → 연결 (원격 https MCP 서버). 비밀값 `MCP_SECRET` 권장 (없으면 SESSION_SECRET에서 열쇠를 만듦 — 이 값을 바꾸면 저장된 토큰을 다시 넣어야 함)
- 로컬 모델: 설정 → 로컬 모델. Ollama는 환경변수 `OLLAMA_ORIGINS=<TriAI 주소>` 필요, LM Studio는 Enable CORS
- 에이전트 팀: ANTHROPIC_API_KEY(+ 필요하면 ANTHROPIC_WORKSPACE_ID). 설정 → 에이전트 팀에서 고르기·예산
