# odot — 백엔드

리버스 투두 추천 앱 `odot`의 백엔드입니다. PRD는 [`PRD.md`](PRD.md), API 명세는 [`docs/API.md`](docs/API.md).

## 핵심 모델 — 프로젝트 = 세션

**프로젝트 하나가 곧 하나의 세션입니다.** 클로드 대화창과 같습니다.

```
프로젝트 만들기(관심사 1개 선택)
        ↓
카드 스와이프 — 키워드를 넘기며 취향을 모은다
        ↓
관심 키워드 3개 이상 쌓이면 기간 선택
        ↓
AI가 그 키워드들을 조합해 할 일 목록 생성
```

카드 덱과 스와이프 이력은 **그 프로젝트 안에만** 쌓입니다. 다른 프로젝트를 열면 완전히 새 데이터로 시작합니다.

**카드에는 할 일이 아니라 키워드가 들어갑니다** — `수학`, `클라이밍`, `심리학`.
사용자가 오른쪽으로 넘긴 키워드들을 나중에 조합해서 할 일을 만듭니다.

**기다리지 않게 만들어 뒀습니다.** 1~5번 카드는 큐레이션 시드 키워드에서 즉시 나오고(실측 ~0.4초),
6번부터는 앞선 카드를 보는 동안 AI가 미리 만들어 둡니다.

## 스택

- **Next.js 15 App Router** — API는 `src/app/api/**` 에만 있습니다
- **Supabase (Postgres)** — 서버에서 service role 로만 접근, 모든 테이블 RLS 차단
- **OpenAI** — 카드 키워드 / 쉬운 요약 / 할 일 생성 + 연령 검열
- **익명 인증** — 기기 단위 `x-device-id` 헤더

## 시작하기

```bash
npm install
```

`.env.local`에 값을 채웁니다 (`.env.example` 참고).

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `SUPABASE_URL` | ✅ | 이미 채워져 있음 |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase 대시보드 → Project Settings → API Keys → `service_role` |
| `OPENAI_API_KEY` | ✅ | |
| `OPENAI_MODEL` | | 기본 `gpt-5.6-luna`. 이 키가 접근 가능한 채팅 모델 |
| `OPENAI_MODERATION_MODEL` | | 기본 `omni-moderation-latest`. 권한이 없으면 채팅 모델이 대신 검열 |
| `OPENAI_TEMPERATURE` | | 지정하지 않으면 보내지 않음 (기본값만 받는 모델이 있어서) |
| `CORS_ALLOW_ORIGIN` | | 프론트를 다른 오리진에서 띄울 때만 |
| `PROJECT_MIN_LIKES` | | 할 일 만들기에 필요한 최소 관심 수. 기본 3 |
| `CARD_DECK_SIZE` | | 한 번에 내려주는 카드 장수. 기본 5 |
| `CARD_LOOKAHEAD` | | 미리 채워 둘 장수. 기본 8 |
| `CARD_REFILL_BATCH` | | 리필 시 한 번에 만들 장수. 기본 8 |

```bash
npm run dev
```

배선 확인:

```bash
curl http://localhost:3000/api/health
```

`env.supabase`와 `env.openai`가 둘 다 `true`여야 정상입니다.

전체 흐름을 한 번에 확인하려면 (서버가 떠 있는 상태에서):

```bash
npm run smoke
```

세션 생성 → 첫 덱 지연 측정 → 키워드 형태 검증 → 선생성 파이프라인 → 스와이프 →
**세션 격리** → 할 일 생성 → 완료 캘린더 → 월간 정산 → 공유 이미지 → 연령 검열 →
소유권 차단까지 69개 검사를 돌립니다. 실제 Supabase·OpenAI를 호출합니다.

## 트렌드 키워드에 대해

**외부 트렌드 API 연동은 넣지 않았습니다.**

처음엔 네이버 데이터랩을 붙이려 했는데, 데이터랩에는 "실시간 급상승 검색어"를 돌려주는 API가
없습니다 (그 서비스 자체가 2021년에 종료됐습니다). 데이터랩이 해주는 일은 *내가 준 키워드들의
최근 검색 비율*을 알려주는 것뿐이라, 어차피 후보 키워드는 우리가 갖고 있어야 했습니다.

그래서 지금은 `seed_keywords` 테이블의 **큐레이션 키워드 풀**(카테고리당 10개, 총 70개)에서
점수 순으로 뽑아 섞어 씁니다. 외부 호출이 없으니 첫 덱이 0.4초 만에 나오고, 실패할 일도 없습니다.

나중에 트렌드 소스를 붙이고 싶다면 [`src/lib/trends.ts`](src/lib/trends.ts)의
`fetchSeedKeywords` 안쪽만 갈아끼우면 됩니다 — 호출부(`deck.ts`)는 그대로 두면 됩니다.

> PRD의 F-OVNIBD는 "최근 트렌드와 사용자 취향 신호를 균형 있게 반영"을 요구합니다.
> 지금은 **취향 신호 쪽만** 충족합니다. 트렌드 반영은 의도적으로 범위에서 뺐습니다.

## 프론트엔드

프로토타입이 붙어 있습니다. `npm run dev` 후 **http://localhost:3000/app.html**.

```
public/
├─ app.html            팀원 프로토타입 원본 + <script> 한 줄
├─ assets/             캐릭터·카테고리 이미지 9개
└─ js/
   ├─ odot-client.js   API 클라이언트 (빌드 불필요한 ES 모듈)
   └─ odot-bridge.js   프로토타입 ↔ 백엔드 연결
```

`public/` 은 같은 오리진에서 서빙되므로 `/api/*` 를 그대로 부를 수 있고 CORS 설정이 필요 없습니다.
파일명은 자유롭지만 `/` 경로만은 `src/app/page.tsx` 가 쓰고 있습니다.

### 브리지 구조

`app.html` 은 **팀원 원본에 맨 아래 한 줄만 더한 상태**입니다.

```html
<script type="module" src="/js/odot-bridge.js"></script>
```

나머지는 전부 [`public/js/odot-bridge.js`](public/js/odot-bridge.js) 안에서 런타임에 이뤄집니다.
프로토타입은 `MockAPI`(localStorage) 위에서 돌아가는데, 브리지가 그 객체의 메서드만 실제 호출로 바꿔 끼웁니다.

| 프로토타입 | → | 백엔드 |
| --- | --- | --- |
| `MockAPI.saveInterests` | | `POST /api/projects` (= **새 세션 시작**) |
| `MockAPI.getRecommendations` | | `GET /api/projects/:id/cards` + `prefetch` |
| `MockAPI.saveReaction` | | `POST /api/cards/:id/reaction` + `prefetch` |
| `MockAPI.createProject` | | `POST /api/projects/:id/todos` |
| `MockAPI.getReview` | | `GET /api/reports/monthly` |
| `MockAPI.getCompletions` | | `GET /api/calendar` |

여기에 더해 브리지가 하는 일:

- **나이 입력 단계 추가** — 온보딩을 벗어나는 모든 경로를 가로채 나이를 먼저 받습니다
- **관심사 1개 선택** — 최대 5개 선택을 1개로 바꾸고, 직접 입력은 '기타'를 골랐을 때만 노출
- **세션 이어가기** — 열려 있던 프로젝트를 `localStorage["odot.projectId"]`에 기억했다가 새로고침 후에도 이어서 엽니다
- **덱 보충** — `prefetch` 는 서버에 카드를 만들게 할 뿐이라, 만들어진 카드를 화면으로
  가져오는 건 별개입니다. 이게 없으면 첫 5장을 다 넘긴 순간 빈 상태로 빠집니다
- **카드 선(先)생성** — 한 장 넘길 때마다 `prefetch`를 던져 다음 카드를 미리 만들어 둡니다
- **쉬운 요약 미리 받기** — 카드가 화면에 뜨는 순간 받아둬서 위로 스와이프가 즉시 뜹니다
- **할 일 완료 저장** — 체크박스가 화면 표시만 바꾸던 것을 서버에 저장해 캘린더에 반영
- **`hidden` 속성 정상화** — `.custom-wrap{display:flex}` 같은 클래스 규칙이 `hidden` 을 덮어써서
  직접 입력란·하단 탭·프로젝트 잠금 영역이 숨겨지지 않고 있었습니다
- **AI 제목 복원** — 프로토타입이 제목을 `'이번 주, 여기서 시작해요'` 로 하드코딩해 덮어쓰고 있었습니다
- **화면 문구 교정** — "더미 AI 응답을 불러오는 중", 2026년 8월로 고정된 정산 머리말을 런타임에 고칩니다

### 브리지가 만들어 붙인 화면

프로토타입에는 없지만 세션 모델에 필요한 화면 둘을 브리지가 런타임에 만들어 넣습니다.
둘 다 친구 CSS 토큰(`--line`, `--muted`, 카테고리 색)을 그대로 씁니다.

**나이 입력** — 온보딩 마지막 단계. 연령 검열에 필요합니다.

**내 프로젝트 목록** (`#odotSessions`) — 하단 탭 맨 왼쪽에 붙습니다.
운동으로 시작했다가 요리가 하고 싶어지면 새 프로젝트를 열면 되고, 목록에서 오갈 수 있습니다.
각 항목은 제목·관심 수·넘긴 카드 수·상태를 보여주고, 지금 보는 프로젝트에는 "보는 중" 배지가 붙습니다.

하단 탭이 5개가 되면서 기존 "프로젝트" 탭은 **"할 일"** 로 이름을 바꿉니다 —
그 화면은 목록이 아니라 *현재 세션의* 할 일 생성 화면이기 때문입니다.

```
내 프로젝트 | 발견 | 할 일 | 정산 | 기록
```

### 화면을 새로 만들 때

```html
<script type="module">
  import { odot, OdotApiError } from "/js/odot-client.js";

  const { needsAge } = await odot.ensureUser();
  if (needsAge) await odot.createUser({ age: 17 });

  const { project, deck } = await odot.createProject({ topic: "study" });
  await odot.react(deck.cards[0].id, "like");
  void odot.prefetch(project.id);          // 다음 카드 미리 만들기
</script>
```

`deviceId` 저장과 `x-device-id` 헤더는 클라이언트가 알아서 처리합니다.
실패는 전부 `OdotApiError` 로 오고 `err.code` 로 분기하면 됩니다 ([`docs/API.md`](docs/API.md) §1).

React 로 옮긴다면 같은 API 의 타입 버전이 [`src/lib/odot-client.ts`](src/lib/odot-client.ts) 에,
전체 타입이 [`src/types/api.ts`](src/types/api.ts) 에 있습니다.

## 디렉터리

```
src/
├─ app/api/           API 라우트 (얇게 — 검증 + 서비스 호출 + 응답)
├─ lib/
│  ├─ age.ts          연령 정책 (구간·차단어·프롬프트 지침)
│  ├─ moderation.ts   연령 검열 (모델 검사 + 로컬 전용 screenLocal)
│  ├─ deck.ts         카드 덱 — 즉시 시딩 + 선생성 파이프라인
│  ├─ projects.ts     프로젝트(세션) 생성 · 자격 · 할 일 생성
│  ├─ reports.ts      월간 정산 집계
│  ├─ trends.ts       큐레이션 시드 키워드 풀 (카테고리별 10개씩)
│  ├─ ai/             OpenAI 프롬프트 3종 (카드 키워드 · 요약 · 할 일)
│  ├─ auth.ts         x-device-id → 사용자
│  ├─ http.ts         ApiResponse 규격 · 에러 변환
│  └─ odot-client.ts  ← 프론트가 쓰는 클라이언트
└─ types/api.ts       ← 프론트가 쓰는 타입
```

## DB

Supabase 프로젝트 `odot` (ref `dkuwhglayyzawmetbkbh`, ap-northeast-2).
전체 DDL은 [`supabase/migrations/`](supabase/migrations/)에 있습니다.

테이블: `users` `projects` `project_sessions` `project_requests` `keyword_cards`
`card_reactions` `seed_keywords` `todos` `monthly_reports` `share_logs` `events` `moderation_logs`

모든 테이블에 RLS가 켜져 있고 **정책이 하나도 없습니다.** 클라이언트 키로는 아무것도 읽거나 쓸 수 없고,
데이터 접근은 service role 을 쓰는 API 라우트를 통해서만 이뤄집니다.

## 배포 전에 확인할 것

- **공유 이미지의 한글 폰트** — `/api/reports/monthly/:month/image` 는 `next/og` 로 PNG 를 만듭니다.
  로컬(Windows)에서는 시스템 한글 폰트를 잡아 정상 렌더되지만, **Vercel 같은 리눅스 런타임에는
  한글 폰트가 없어 글자가 깨질 수 있습니다.** 배포한다면 한글 폰트 파일을 저장소에 넣고
  `ImageResponse` 의 `fonts` 옵션으로 넘겨야 합니다.
- **선생성 파이프라인과 서버리스** — `deck.ts` 의 동시 생성 방지 락은 프로세스 메모리에 있습니다.
  인스턴스가 여러 개로 늘면 같은 프로젝트에 대해 중복 생성이 일어날 수 있는데,
  `(project_id, keyword)` 유니크 인덱스가 중복 카드는 막아 주므로 낭비만 생기고 데이터는 안전합니다.
- **OpenAI 모델 권한** — 현재 키는 `gpt-5.6-luna` 와 `text-embedding-3-small` 만 쓸 수 있고
  moderation 모델 권한이 없습니다. 그래서 검열을 채팅 모델이 대신합니다.
  키를 바꾼다면 `npm run smoke` 로 확인하세요.

## 이번 범위에서 뺀 것

PRD의 "범위 밖" 항목을 따랐습니다.

- 외부 캘린더 연동 / 일정 자동 등록
- 인스타그램 외 SNS 공유
- 운영자(관리자) 기능 — PRD에 역할만 있고 기능이 없음
