/**
 * 전체 흐름 스모크 테스트.
 *
 *   npm run dev        (다른 터미널)
 *   npm run smoke
 *
 * 실제 Supabase 와 OpenAI 를 호출하므로 .env.local 이 채워져 있어야 한다.
 * BASE 환경변수로 주소를 바꿀 수 있다. (기본 http://localhost:3000)
 */
const BASE = process.env.BASE ?? "http://localhost:3000";
const AGE = Number(process.env.SMOKE_AGE ?? 17);

let deviceId = null;
let passed = 0;
const failures = [];

async function call(method, path, body, { auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && deviceId) headers["x-device-id"] = deviceId;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json();
  return { status: res.status, ...json };
}

function check(name, condition, extra) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${extra ? `\n       ${JSON.stringify(extra)}` : ""}`);
  }
}

const step = (title) => console.log(`\n${title}`);
const note = (text) => console.log(`       → ${text}`);

/** 이 프로젝트에서 관심 자격이 찰 때까지 like 를 쌓는다. */
async function fillLikes(projectId) {
  for (let round = 0; round < 8; round++) {
    const e = await call("GET", `/api/projects/${projectId}/eligibility`);
    if (e.data?.eligible) return e.data;
    const deck = await call("GET", `/api/projects/${projectId}/cards`);
    const cards = deck.data?.cards ?? [];
    if (cards.length === 0) break;
    for (const c of cards) {
      const r = await call("GET", `/api/projects/${projectId}/eligibility`);
      if (r.data?.eligible) break;
      await call("POST", `/api/cards/${c.id}/reaction`, { reaction: "like" });
    }
  }
  return (await call("GET", `/api/projects/${projectId}/eligibility`)).data;
}

async function main() {
  console.log(`odot smoke test → ${BASE} (나이 ${AGE})`);

  step("0. 환경");
  const health = await call("GET", "/api/health", undefined, { auth: false });
  check("health ok", health.ok === true);
  check("SUPABASE 설정됨", health.data?.env?.supabase === true, health.data?.env);
  check("OPENAI 설정됨", health.data?.env?.openai === true, health.data?.env);
  if (!health.data?.env?.supabase) {
    console.log("\nSUPABASE_SERVICE_ROLE_KEY 가 없어 중단합니다.");
    process.exit(1);
  }
  note(`네이버 데이터랩: ${health.data?.env?.naver ? "설정됨" : "미설정 (기본 순서로 대체)"}`);

  step("1. 인증");
  const noAuth = await call("GET", "/api/me", undefined, { auth: false });
  check("헤더 없으면 401", noAuth.status === 401 && noAuth.error?.code === "UNAUTHENTICATED");

  const created = await call("POST", "/api/users/anonymous", { age: AGE }, { auth: false });
  check("익명 사용자 생성", created.ok === true, created.error);
  deviceId = created.data?.user?.deviceId;
  check("deviceId 발급", Boolean(deviceId));
  check(
    "나이로 ageGroup 계산",
    created.data?.user?.ageGroup ===
      (AGE < 13 ? "child" : AGE < 16 ? "middle" : AGE < 19 ? "high" : "adult"),
    created.data?.user,
  );
  check("isMinor 계산", created.data?.user?.isMinor === AGE < 19);

  const again = await call("POST", "/api/users/anonymous", { deviceId, age: AGE }, { auth: false });
  check("같은 deviceId 재호출 시 동일 사용자", again.data?.user?.id === created.data.user.id);

  const badAge = await call("POST", "/api/users/anonymous", { age: 3 }, { auth: false });
  check("나이 범위 밖이면 400", badAge.status === 400);

  step("2. 관심사 주제");
  const topics = await call("GET", "/api/topics", undefined, { auth: false });
  check("카드 7종", topics.data?.topics?.length === 7);
  check("기타는 직접 입력 필요", topics.data?.topics?.find((t) => t.id === "etc")?.requiresInput === true);

  step("3. 세션 시작 — 첫 덱은 기다리지 않는다");
  const etcNoInput = await call("POST", "/api/projects", { topic: "etc" });
  check("기타인데 입력 없으면 400", etcNoInput.status === 400, etcNoInput.error);

  const t0 = Date.now();
  const created1 = await call("POST", "/api/projects", { topic: "study" });
  const elapsed = Date.now() - t0;
  check("프로젝트(세션) 생성", created1.ok === true, created1.error);
  const p1 = created1.data?.project;
  const deck1 = created1.data?.deck;
  check("생성 응답에 첫 덱 동봉", (deck1?.cards?.length ?? 0) > 0, deck1);
  check("status = collecting", p1?.status === "collecting", p1);
  check("기간은 아직 없음", p1?.duration === null);
  check("세션 키 발급", Boolean(p1?.sessionKey));
  note(`${elapsed}ms 만에 ${deck1.cards.length}장 · source=${[...new Set(deck1.cards.map((c) => c.source))].join(",")}`);
  note(`카드: ${deck1.cards.map((c) => c.keyword).join(" / ")}`);

  check(
    "첫 덱은 AI 대기 없이 트렌드/기본에서 온다",
    deck1.cards.every((c) => c.source === "trend" || c.source === "default"),
    [...new Set(deck1.cards.map((c) => c.source))],
  );
  check("첫 덱 생성이 5초 안에 끝난다", elapsed < 5000, `${elapsed}ms`);

  step("4. 카드는 '할 일'이 아니라 '키워드'");
  const longest = deck1.cards.reduce((a, c) => Math.max(a, c.keyword.length), 0);
  check("키워드가 짧다 (12자 이하)", longest <= 12, `가장 긴 것 ${longest}자`);
  check(
    "'~하기' 같은 행동 문구가 없다",
    deck1.cards.every((c) => !/(하기|보기|읽기|쓰기|만들기)$/.test(c.keyword)),
    deck1.cards.map((c) => c.keyword),
  );

  step("5. 선(先)생성 파이프라인");
  const before = await call("GET", `/api/projects/${p1.id}/cards`);
  const pre = await call("POST", `/api/projects/${p1.id}/cards/prefetch`, { lookahead: 9 });
  check("prefetch 로 카드가 늘어난다", pre.data?.remaining > (before.data?.remaining ?? 0), pre.data);
  note(`${before.data.remaining}장 → ${pre.data.remaining}장 (${pre.data.generated}장 생성)`);

  const preAgain = await call("POST", `/api/projects/${p1.id}/cards/prefetch`, { lookahead: 4 });
  check("이미 충분하면 아무것도 안 만든다", preAgain.data?.generated === 0, preAgain.data);

  const aiDeck = await call("GET", `/api/projects/${p1.id}/cards?limit=20`);
  const aiCards = aiDeck.data.cards.filter((c) => c.source === "ai");
  check("AI 카드가 덱에 들어왔다", aiCards.length > 0, aiDeck.data.cards.map((c) => c.source));
  if (aiCards.length) note(`AI 키워드: ${aiCards.slice(0, 6).map((c) => c.keyword).join(" / ")}`);
  check(
    "AI 카드도 짧은 키워드다",
    aiCards.every((c) => c.keyword.length <= 12),
    aiCards.map((c) => c.keyword),
  );

  step("6. 스와이프");
  const cards = aiDeck.data.cards;
  const like = await call("POST", `/api/cards/${cards[0].id}/reaction`, { reaction: "like" });
  check("오른쪽 스와이프", like.data?.reaction === "like", like.error);
  check("응답에 projectId 포함", like.data?.projectId === p1.id);
  check("like 에는 요약 없음", like.data?.summary === null);

  const dup = await call("POST", `/api/cards/${cards[0].id}/reaction`, { reaction: "pass" });
  check("같은 카드 재반응 → ALREADY_REACTED", dup.error?.code === "ALREADY_REACTED");

  const detail = await call("POST", `/api/cards/${cards[1].id}/reaction`, { reaction: "detail" });
  check("위로 스와이프 시 쉬운 요약 동봉", Boolean(detail.data?.summary?.easySummary), detail.error);
  if (detail.data?.summary) note(`"${detail.data.summary.easySummary}"`);

  const after = await call("GET", `/api/projects/${p1.id}/cards?limit=20`);
  const reacted = new Set([cards[0].id, cards[1].id]);
  check("반응한 카드는 다시 나오지 않음", after.data.cards.every((c) => !reacted.has(c.id)));

  step("7. 세션 격리 — 다른 프로젝트는 새 데이터");
  const created2 = await call("POST", "/api/projects", { topic: "exercise" });
  const p2 = created2.data?.project;
  const deck2 = created2.data?.deck;
  check("두 번째 세션 생성", created2.ok === true, created2.error);
  check("다른 세션 id", p2.id !== p1.id);
  note(`세션2 카드: ${deck2.cards.map((c) => c.keyword).join(" / ")}`);

  const ids1 = new Set(after.data.cards.map((c) => c.id));
  check(
    "세션2의 카드는 세션1과 완전히 별개",
    deck2.cards.every((c) => !ids1.has(c.id)),
  );
  check(
    "세션2는 세션1의 관심사(공부)가 아니라 자기 관심사(운동)를 쓴다",
    deck2.cards.filter((c) => c.category === "exercise").length >= deck2.cards.length / 2,
    deck2.cards.map((c) => c.category),
  );

  const elig2 = await call("GET", `/api/projects/${p2.id}/eligibility`);
  check("세션2의 관심 수는 0에서 시작", elig2.data?.likeCount === 0, elig2.data);

  const list = await call("GET", "/api/projects");
  check("프로젝트 목록에 둘 다 있다", list.data?.projects?.length >= 2);
  check("목록이 최근 활동 순", list.data.projects[0].id === p2.id, list.data.projects.map((p) => p.id));
  const listed1 = list.data.projects.find((p) => p.id === p1.id);
  check("목록에 세션별 스와이프 수", listed1?.reactionCount === 2, listed1);

  step("8. 관심 키워드 → 할 일 생성");
  const notEnough = await call("POST", `/api/projects/${p2.id}/todos`, { duration: "1w" });
  check("관심 부족하면 NOT_ENOUGH_SIGNAL", notEnough.error?.code === "NOT_ENOUGH_SIGNAL", notEnough.error);

  const elig1 = await fillLikes(p1.id);
  check("관심을 채우면 생성 가능", elig1?.eligible === true, elig1);
  note(`관심 키워드: ${elig1.likedKeywords.join(", ")}`);

  const todoRes = await call("POST", `/api/projects/${p1.id}/todos`, { duration: "1w" });
  check("할 일 생성", todoRes.ok === true, todoRes.error);
  if (!todoRes.ok) return summary();
  const project = todoRes.data.project;
  note(`"${project.title}" · 할 일 ${project.todos.length}개`);
  note(project.todos.slice(0, 3).map((t) => `${t.recommendedAt ?? "-"}: ${t.content}`).join("\n         "));
  check("status ready", project.status === "ready");
  check("기간 반영", project.duration === "1w");
  check("AI 제목 있음", Boolean(project.title));
  check("할 일 순서가 orderIndex 오름차순", project.todos.every((t, i) => t.orderIndex === i));
  check(
    "할 일이 관심 키워드를 반영",
    project.keywords.length > 0,
    project.keywords,
  );

  const reload = await call("GET", `/api/projects/${p1.id}`);
  check("세션 다시 열면 할 일이 그대로", reload.data?.project?.todos?.length === project.todos.length);

  step("9. 할 일 완료 + 캘린더");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const month = today.slice(0, 7);

  const done1 = await call("PATCH", `/api/todos/${project.todos[0].id}`, { isCompleted: true, category: "공부" });
  check("할 일 완료 처리", done1.data?.todo?.isCompleted === true, done1.error);
  check("completedAt 채워짐", Boolean(done1.data?.todo?.completedAt));
  await call("PATCH", `/api/todos/${project.todos[1].id}`, { isCompleted: true, category: "공부" });
  await call("PATCH", `/api/todos/${project.todos[2].id}`, { isCompleted: true, category: "운동" });

  const cal = await call("GET", `/api/calendar?month=${month}`);
  const day = cal.data?.days?.find((d) => d.date === today);
  check("오늘 날짜가 캘린더에 잡힘", Boolean(day), cal.data);
  check("대표 카테고리 = 최다 완료", day?.topCategory === "공부", day);
  check("완료 수 집계", day?.doneCount === 3, day);

  const dayDetail = await call("GET", `/api/calendar/${today}`);
  check("날짜 상세 조회", dayDetail.data?.doneCount === 3, dayDetail.error);

  const undo = await call("PATCH", `/api/todos/${project.todos[2].id}`, { isCompleted: false });
  check("완료 취소 시 completedAt 제거", undo.data?.todo?.completedAt === null);
  check("잘못된 날짜 형식 → 400", (await call("GET", "/api/calendar/2026-13-40")).status === 400);

  step("10. 월간 정산 + 공유");
  const report = await call("GET", `/api/reports/monthly?month=${month}`);
  check("정산 조회", report.ok === true, report.error);
  check("빈 상태 아님", report.data?.report?.isEmpty === false);
  check("상위 키워드 5개 이하", (report.data?.report?.topKeywords?.length ?? 0) <= 5);
  note(`상위: ${report.data.report.topKeywords.map((k) => `${k.rank}.${k.keyword}(${k.score})`).join(" ")}`);
  check("반응 없는 달은 isEmpty", (await call("GET", "/api/reports/monthly?month=2020-01")).data?.report?.isEmpty === true);

  const imgRes = await fetch(`${BASE}/api/reports/monthly/${month}/image`, {
    headers: { "x-device-id": deviceId },
  });
  check("공유 이미지 200 PNG", imgRes.status === 200 && imgRes.headers.get("content-type")?.includes("image/png"));
  const bytes = (await imgRes.arrayBuffer()).byteLength;
  check("공유 이미지 크기 정상", bytes > 5000, `${bytes} bytes`);
  note(`${(bytes / 1024).toFixed(0)} KB`);
  check("공유 기록", (await call("POST", `/api/reports/monthly/${month}/share`, { result: "success" })).data?.log?.result === "success");

  step("11. 연령 검열");
  const banned = await call("POST", "/api/projects", { topic: "etc", customTopic: "술 마시기" });
  check(
    AGE < 19 ? "미성년자 금칙어 입력 차단" : "성인은 통과",
    AGE < 19 ? banned.error?.code === "AGE_RESTRICTED" : banned.ok === true,
    banned.error ?? "ok",
  );

  step("12. 소유권");
  const other = await call("POST", "/api/users/anonymous", { age: 20 }, { auth: false });
  const mine = deviceId;
  deviceId = other.data.user.deviceId;
  check("남의 프로젝트 접근 차단", (await call("GET", `/api/projects/${p1.id}`)).error?.code === "FORBIDDEN");
  check("남의 덱 접근 차단", (await call("GET", `/api/projects/${p1.id}/cards`)).error?.code === "FORBIDDEN");
  check("남의 할 일 수정 차단", (await call("PATCH", `/api/todos/${project.todos[0].id}`, { isCompleted: false })).error?.code === "FORBIDDEN");
  const otherList = await call("GET", "/api/projects");
  check("남의 프로젝트는 목록에도 없다", (otherList.data?.projects?.length ?? 0) === 0);
  deviceId = mine;

  summary();
}

function summary() {
  console.log(`\n${"─".repeat(50)}`);
  if (failures.length === 0) {
    console.log(`PASS · ${passed}개 검사 모두 통과`);
  } else {
    console.log(`FAIL · ${passed}개 통과, ${failures.length}개 실패`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\n스모크 테스트 중 예외:", err);
  process.exitCode = 1;
});
