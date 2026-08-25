# odot 백엔드 API

프론트엔드 연결용 명세입니다. 타입은 [`src/types/api.ts`](../src/types/api.ts)에 전부 정의되어 있고,
바로 쓸 수 있는 클라이언트는 [`src/lib/odot-client.ts`](../src/lib/odot-client.ts)(타입)과
[`public/js/odot-client.js`](../public/js/odot-client.js)(브라우저, 빌드 불필요)에 있습니다.

---

## 0. 핵심 개념 — 프로젝트 = 세션

**프로젝트 하나가 곧 하나의 세션입니다.** 클로드 대화창과 같은 모델이라고 보면 됩니다.

- 프로젝트에 들어가면 그 안에서 카드 스와이프가 시작됩니다.
- 카드 덱과 스와이프 이력은 **그 프로젝트 안에만** 쌓입니다.
- 다른 프로젝트를 열면 **완전히 새 데이터로 시작**합니다.
- 관심사(7개 중 1개)도 프로젝트마다 고릅니다.

```ts
import { odot } from "@/lib/odot-client";

// 1. 첫 실행 — 기기 등록 (나이 필수)
await odot.createUser({ age: 17 });

// 2. 새 세션 열기 — 첫 카드 덱이 함께 온다 (AI 대기 없음, 실측 ~0.4초)
const { project, deck } = await odot.createProject({ topic: "study" });

// 3. 스와이프 + 다음 카드 미리 만들기
await odot.react(deck.cards[0].id, "like");
void odot.prefetch(project.id);          // 응답을 기다릴 필요 없음

// 4. 관심 키워드가 쌓이면 조합해서 할 일 만들기
const { project: done } = await odot.createTodos(project.id, "1w");
```

### 카드는 '할 일'이 아니라 '키워드'입니다

카드에 담기는 건 **짧은 주제 키워드**입니다 — `수학`, `클라이밍`, `심리학`, `포트폴리오`.
`오답노트 다시 쓰기` 같은 행동 문구가 아닙니다. 사용자가 오른쪽으로 넘긴 키워드들을
**나중에 조합해서** 할 일을 만듭니다.

### 기다리지 않게 만드는 구조

| 카드 | 어디서 오나 | 걸리는 시간 |
| --- | --- | --- |
| 1~5번 | 큐레이션 시드 키워드 (AI 호출 없음) | ~0.4초 |
| 6번부터 | AI 생성 — 앞선 카드를 볼 때 미리 만들어 둠 | 사용자는 대기 없음 |

`POST /api/projects/:id/cards/prefetch` 를 **카드를 한 장 넘길 때마다** 부르면 됩니다.
남은 장수가 충분하면 아무것도 하지 않고 즉시 돌아오고, 모자라면 한 번에 5장을 만들어 채웁니다.

---

## 1. 공통 규칙

### 응답 형태

**성공하든 실패하든 모양이 하나입니다.**

```jsonc
{ "ok": true,  "data": { /* 엔드포인트별 응답 */ } }
{ "ok": false, "error": { "code": "NOT_ENOUGH_SIGNAL", "message": "카드를 2개만 더 …", "details": {} } }
```

`error.message`는 **그대로 화면에 띄워도 되는 한국어**입니다. 분기는 `error.code`로 하세요.

### 인증

로그인이 없습니다. 기기 단위 익명 사용자입니다.

1. 첫 실행 때 `POST /api/users/anonymous` 로 사용자를 만듭니다.
2. 응답의 `user.deviceId`를 기기에 저장합니다. (클라이언트가 `localStorage["odot.deviceId"]`에 자동 저장)
3. 이후 **모든 요청에 `x-device-id: <deviceId>` 헤더**를 실습니다.

### 에러 코드

| code | HTTP | 언제 | 프론트 처리 |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | 입력 형식 오류 | 폼 오류 표시 |
| `UNAUTHENTICATED` | 401 | `x-device-id` 없음 | 시작 화면으로 |
| `USER_NOT_FOUND` | 401 | 등록 안 된 기기 | deviceId 지우고 다시 생성 |
| `FORBIDDEN` | 403 | 남의 리소스 | 목록으로 |
| `NOT_FOUND` | 404 | 없는 리소스 | — |
| `ALREADY_REACTED` | 409 | 이미 넘긴 카드 | 무시하고 다음 카드로 |
| `NOT_ENOUGH_SIGNAL` | 409 | 관심 키워드 부족 | "카드를 더 넘겨주세요" 안내 |
| `AGE_RESTRICTED` | 422 | 연령 정책 위반 | 안내 후 다른 값 요청 |
| `AI_FAILED` | 502 | AI 생성 실패 | **"다시 만들기" 버튼** 노출 |
| `INTERNAL` | 500 | 서버 오류 | 재시도 안내 |

### 시간

- 모든 타임스탬프는 **UTC ISO 8601** 문자열입니다.
- 단, **캘린더의 "하루"와 월간 정산의 "한 달"은 한국 시간(Asia/Seoul) 기준**으로 잘립니다.

---

## 2. 사용자

### `POST /api/users/anonymous` · 기기 등록

인증 불필요. 여러 번 호출해도 안전합니다(같은 `deviceId`면 기존 사용자를 돌려줌).

```jsonc
// 요청
{ "deviceId": "선택 · 기존 값이 있으면", "age": 17 }

// 응답 data
{
  "user": { "id": "…", "deviceId": "…", "age": 17, "ageGroup": "high", "isMinor": true, … },
  "isNew": true
}
```

`age`는 5~120 정수. **필수**입니다 — 연령별 콘텐츠 검열의 기준값입니다. (§9 참고)
관심사는 여기서 받지 않습니다 — 프로젝트를 만들 때 프로젝트마다 고릅니다.

### `GET /api/me` · 내 정보 + 모든 프로젝트 합산 통계
### `PATCH /api/me` · 나이 수정 `{ "age": 18 }`

나이를 바꾸면 연령 정책이 즉시 다시 적용되고, **새 나이로는 볼 수 없는 미반응 카드가 자동으로 정리**됩니다.

---

## 3. 관심사 주제

### `GET /api/topics` · 카드 7종

인증 불필요. 새 프로젝트를 시작할 때 이 중 정확히 하나를 고릅니다.

```jsonc
{ "topics": [
  { "id": "exercise", "label": "운동", "color": "red",    "requiresInput": false },
  { "id": "study",    "label": "공부", "color": "orange", "requiresInput": false },
  { "id": "reading",  "label": "독서", "color": "green",  "requiresInput": false },
  { "id": "music",    "label": "음악", "color": "purple", "requiresInput": false },
  { "id": "culture",  "label": "교양", "color": "yellow", "requiresInput": false },
  { "id": "career",   "label": "진로", "color": "blue",   "requiresInput": false },
  { "id": "etc",      "label": "기타", "color": "gray",   "requiresInput": true  }
] }
```

---

## 4. 프로젝트 = 세션

### `GET /api/projects` · 세션 목록 (최근 활동 순)

대화 목록처럼 쓰면 됩니다.

```jsonc
{ "projects": [{
  "id": "…", "title": "영어로 읽는 과학 데이터 프로젝트",
  "topic": "study", "customTopic": null,
  "duration": "1w", "status": "ready",
  "createdAt": "…", "updatedAt": "…",
  "reactionCount": 12, "likeCount": 5, "todoCount": 7
}] }
```

`title`은 할 일을 만들기 전에는 `null`입니다 (아직 카드 모으는 중).

### `POST /api/projects` · 새 세션 열기

```jsonc
{ "topic": "study" }                        // 또는
{ "topic": "etc", "customTopic": "사진" }
```

```jsonc
// 응답 data — 프로젝트와 첫 덱이 함께 온다
{
  "project": {
    "id": "…", "title": null, "description": null,
    "topic": "study", "customTopic": null, "keywords": [],
    "duration": null, "status": "collecting", "errorMessage": null,
    "sessionKey": "proj_…", "createdAt": "…", "updatedAt": "…", "todos": []
  },
  "deck": {
    "projectId": "…",
    "cards": [{ "id": "…", "keyword": "코딩", "intro": "컴퓨터에게 일을 시키는 언어",
                "reason": "지금 해볼 만한 주제예요.", "category": "study",
                "source": "default", "createdAt": "…" }],
    "remaining": 5
  }
}
```

- **첫 덱이 응답에 동봉되므로 카드 요청을 따로 할 필요가 없습니다.**
- `customTopic`도 연령 검열을 거칩니다 → 걸리면 `AGE_RESTRICTED`.
- `status`: `collecting`(카드 모으는 중) → `generating` → `ready` / `failed`

### `GET /api/projects/:projectId` · 세션 열기

프로젝트 + 할 일 + 이 세션의 진행 상황(`eligibility`)이 함께 옵니다.

### `GET /api/projects/:projectId/eligibility` · 할 일 만들기 버튼 켤지 말지

```jsonc
{
  "projectId": "…",
  "eligible": false,
  "likeCount": 1,
  "requiredLikeCount": 3,
  "likedKeywords": ["코딩"],
  "message": "카드를 2개만 더 관심으로 넘기면 할 일을 만들 수 있어요.",
  "durations": [ { "id": "1d", "label": "1일" }, … ]
}
```

`message`를 그대로 안내 문구로, `durations`를 기간 선택 UI에 뿌리면 됩니다.
`requiredLikeCount`는 `.env`의 `PROJECT_MIN_LIKES`로 조절합니다.

---

## 5. 카드

### `GET /api/projects/:projectId/cards?limit=5` · 덱

```jsonc
{ "projectId": "…", "cards": [ … ], "remaining": 8 }
```

- 반응이 확정된 카드는 **절대 다시 나오지 않습니다.**
- 덱이 비어 있으면 시드 키워드로 **즉시** 채웁니다 (AI 대기 없음).
- `easySummary`는 여기 오지 않습니다 — 위로 스와이프할 때 받습니다.
- `source`: `default`(큐레이션 시드 풀) · `ai`(생성)

### `POST /api/projects/:projectId/cards/prefetch` · 미리 만들기

```jsonc
{ "lookahead": 4 }   // 생략 가능
```
```jsonc
{ "remaining": 8, "generated": 5 }
```

**카드를 한 장 넘길 때마다 부르면 됩니다.** 응답을 기다릴 필요 없습니다.

- 남은 장수가 `lookahead` 이상이면 `generated: 0`으로 즉시 돌아옵니다.
- 모자라면 한 번에 5장(`CARD_REFILL_BATCH`)을 만들어 버퍼를 채웁니다.
- 같은 프로젝트에 대한 동시 호출은 서버에서 하나로 합쳐집니다.

### `POST /api/cards/:cardId/reaction` · 스와이프 확정

**손가락을 뗄 때 딱 한 번** 호출합니다. 중간에 취소했으면 호출하지 않으면 됩니다.

```jsonc
{ "reaction": "like" }   // like = 오른쪽 · pass = 왼쪽 · detail = 위
```
```jsonc
{
  "projectId": "…", "cardId": "…", "reaction": "detail", "reactedAt": "…",
  "summary": { "cardId": "…", "keyword": "수학",
               "easySummary": "수학은 숫자와 여러 가지 규칙을 알아보는 공부예요. …" },
  "remaining": 7
}
```

- `reaction: "detail"`이면 `summary`에 **초등학생도 이해할 수 있는 1~2문장 요약**이 함께 옵니다.
- 같은 카드에 두 번 호출하면 `ALREADY_REACTED`.
- 반응은 카드가 속한 프로젝트에만 기록됩니다.

### `GET /api/cards/:cardId/summary` · 요약만 따로

반응 확정과 요약 표시를 분리하고 싶을 때만 씁니다.

---

## 6. 할 일

### `POST /api/projects/:projectId/todos` · 관심 키워드 → 할 일

```jsonc
{ "duration": "1w" }   // 1d | 1w | 1m | 3m | 6m
```

이 프로젝트에서 오른쪽으로 넘긴 키워드들**만** 재료로 씁니다 (다른 프로젝트와 섞이지 않음).

```jsonc
// 응답 data.project
{
  "id": "…", "title": "영어로 읽는 과학 데이터 프로젝트",
  "description": "…", "keywords": ["과학", "영어", "코딩"],
  "topic": "study", "duration": "1w", "status": "ready",
  "sessionKey": "proj_…",
  "todos": [
    { "id": "…", "projectId": "…", "content": "관심 있는 과학 주제 1개와 핵심 개념 5개 정하기",
      "category": "공부", "orderIndex": 0, "recommendedAt": "1일차",
      "isCompleted": false, "completedAt": null }
  ]
}
```

- **동기 호출입니다.** AI 생성 때문에 응답까지 몇 초 걸리므로 진행 상태를 띄워두세요.
- `todos` 배열 순서 = 권장 수행 순서(`orderIndex` 오름차순).
- 기간별 할 일 개수: 1일 4개 · 1주 7개 · 1개월 12개 · 3개월 18개 · 6개월 24개
- `todos[].category`는 관심사 7종(운동/공부/독서/음악/교양/진로/기타) 중 하나로 고정됩니다 — 캘린더 색과 맞추기 위함입니다.
- **다시 호출하면 기존 할 일을 지우고 재생성합니다.** `AI_FAILED` 화면의 "다시 만들기" 버튼도 같은 호출을 쓰면 됩니다.

### `PATCH /api/todos/:todoId` · 완료 처리 / 카테고리 변경

```jsonc
{ "isCompleted": true }                     // completedAt 이 지금 시각으로 채워짐
{ "isCompleted": true, "category": "운동" }  // 캘린더 집계용 카테고리도 함께 지정
{ "isCompleted": false }                    // 되돌리면 completedAt 이 지워짐
```

---

## 7. 완료 캘린더 (F-IYXFDA)

프로젝트를 가리지 않고 **모든 프로젝트를 합쳐서** 봅니다.

### `GET /api/calendar?month=YYYY-MM`

```jsonc
{
  "month": "2026-08",
  "days": [
    { "date": "2026-08-25", "topCategory": "공부", "doneCount": 3,
      "breakdown": [ { "category": "공부", "count": 2 }, { "category": "운동", "count": 1 } ] }
  ]
}
```

- **완료한 할 일이 없는 날짜는 배열에 아예 들어가지 않습니다.** 그 칸은 비워두면 됩니다.
- 완료 수가 동률이면 **가장 최근에 완료한 할 일의 카테고리**가 `topCategory`가 됩니다.

### `GET /api/calendar/:date` · 날짜 상세 (`YYYY-MM-DD`)

`doneCount`, 카테고리별 `breakdown`, 그날 완료한 `todos` 전체.

---

## 8. 월간 정산 & 인스타 공유

프로젝트를 가리지 않고 한 달 전체의 카드 반응을 봅니다.

### `GET /api/reports/monthly?month=YYYY-MM`

```jsonc
{
  "month": "2026-08",
  "topKeywords": [ { "keyword": "과학", "category": "study",
                     "score": 3, "rank": 1, "delta": null, "isNew": true } ],
  "totalReactions": 12, "likeCount": 5,
  "isEmpty": false, "generatedAt": "…",
  "shareImageUrl": "/api/reports/monthly/2026-08/image"
}
```

- 상위 **5개**만 옵니다. 점수 = `like×3 + detail×2 − pass×1`.
- `delta`는 지난달 같은 키워드 대비 변화량. 지난달에 없던 키워드면 `delta: null`, `isNew: true`.
- **`isEmpty: true`면 그달 반응이 없다는 뜻** → "관심사를 더 탐색해보세요" 빈 상태 화면.

### `GET /api/reports/monthly/:month/image` · 공유용 1080×1080 PNG

`<img src>`로는 헤더를 실을 수 없으니 `fetch`로 받으세요. 클라이언트의 `shareToInstagram()`이 전부 대신 해줍니다.

```ts
import { shareToInstagram } from "@/lib/odot-client";
const result = await shareToInstagram("2026-08");
if (result === "no_app") showInstagramInstallGuide();
```

### `POST /api/reports/monthly/:month/share` · 공유 결과 기록

`{ "result": "success" }` — `requested | success | failed | no_app`

---

## 9. 연령별 콘텐츠 검열

가입 시 받은 나이로 사용자를 네 구간으로 나누고, **AI가 만든 모든 텍스트와 사용자가 직접 입력한
관심사를 걸러냅니다.** 프론트에서 따로 해줄 일은 없고, 걸리면 `AGE_RESTRICTED`가 옵니다.

| `ageGroup` | 나이 | 추가로 막는 것 |
| --- | --- | --- |
| `child` | ~12세 | 혼자 이동·아르바이트·유료 활동·익명 채팅까지 차단, 가장 엄격 |
| `middle` | 13~15세 | 야간 활동·랜덤 채팅 추가 차단 |
| `high` | 16~18세 | 미성년자 공통 차단(음주·흡연·도박·투자·문신 등) |
| `adult` | 19세~ | 불법·자해·도박 등 공통 차단만 |

거르는 순서 (싼 것부터):

1. **프롬프트 제약** — 연령대별 지침을 AI 시스템 프롬프트에 주입
2. **금칙어 필터** — 연령대별 차단어 부분 문자열 검사
3. **최소 연령 필터** — 항목의 `minAge`가 사용자 나이보다 높으면 제외
4. **모델 검사** — 남은 항목만 배치 검사

4단계는 OpenAI Moderation API를 먼저 쓰고, **키에 moderation 모델 권한이 없으면 채팅 모델을
분류기로 써서 같은 판정을 대신합니다.** 두 수단이 모두 실패하면 전부 차단합니다 —
미성년자가 쓰는 서비스라 열어두는 쪽보다 닫는 쪽을 택했습니다.

> **예외**: `seed_keywords`에 우리가 직접 넣어 둔 키워드는 이미 검증된 데이터라
> 1~3단계(로컬 검사)만 거칩니다. 모델 호출을 건너뛰므로 첫 덱이 0.4초 만에 나옵니다.

차단된 항목은 전부 `moderation_logs` 테이블에 남아 나중에 기준을 조정할 수 있습니다.

---

## 10. 이벤트 로그 (KPI)

서버가 직접 알 수 없는 화면 이벤트만 프론트에서 보내면 됩니다.
(프로젝트 생성, 카드 반응/노출/프리페치, 할 일 생성, 공유 시도는 **서버가 자동으로 기록**합니다.)

`POST /api/events` · `{ "type": "…", "payload": { … } }`

---

## 11. 전체 엔드포인트

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| GET | `/api/health` | 배선/환경변수 확인 |
| POST | `/api/users/anonymous` | 기기 등록 (나이 필수) |
| GET / PATCH | `/api/me` | 내 정보 · 나이 수정 |
| GET | `/api/topics` | 관심사 카드 7종 |
| GET | `/api/projects` | 세션 목록 |
| POST | `/api/projects` | **새 세션 + 첫 덱** |
| GET | `/api/projects/:id` | 세션 열기 (할 일 + 진행 상황) |
| GET | `/api/projects/:id/eligibility` | 할 일 만들기 가능 여부 |
| GET | `/api/projects/:id/cards` | 이 세션의 덱 |
| POST | `/api/projects/:id/cards/prefetch` | **다음 카드 미리 만들기** |
| POST | `/api/cards/:cardId/reaction` | 스와이프 확정 (+요약) |
| GET | `/api/cards/:cardId/summary` | 쉬운 요약 |
| POST | `/api/projects/:id/todos` | 관심 키워드 → 할 일 (재생성 겸용) |
| PATCH | `/api/todos/:todoId` | 완료 처리 · 카테고리 |
| GET | `/api/calendar` | 월별 대표 카테고리 |
| GET | `/api/calendar/:date` | 날짜 상세 |
| GET | `/api/reports/monthly` | 월간 정산 |
| GET | `/api/reports/monthly/:month/image` | 공유 PNG (1080×1080) |
| POST | `/api/reports/monthly/:month/share` | 공유 기록 |
| POST | `/api/events` | KPI 이벤트 |
