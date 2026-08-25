/**
 * odot 프로토타입 ↔ 실제 백엔드 브리지.
 *
 * 친구가 만든 app.html 은 `MockAPI`(localStorage) 위에서 돌아간다.
 * 이 파일은 app.html 을 거의 건드리지 않고 그 위에 얹혀서:
 *
 *   1. MockAPI 의 각 메서드를 실제 /api/* 호출로 바꾼다
 *   2. 온보딩에 나이 입력 단계를 추가한다 (연령 검열에 필요)
 *   3. 관심사 선택을 최대 5개 → 정확히 1개로 바꾼다 (매니페스트 최신본)
 *   4. 할 일 완료 체크를 서버에 저장해 캘린더에 반영한다
 *   5. 정산 공유를 실제 1080x1080 PNG 공유로 바꾼다
 *
 * app.html 에 추가된 것은 맨 아래 <script type="module"> 한 줄뿐이다.
 * 친구가 새 프로토타입을 보내오면 그 한 줄만 다시 붙이면 된다.
 *
 * 앞의 <script> 는 클래식 스크립트라 거기 선언된 const/let/function 이
 * 전역에 있고, 모듈인 이 파일에서 그대로 읽고 바꿀 수 있다.
 * 모듈은 defer 처럼 나중에 실행되므로 아래 코드가 항상 뒤에 온다.
 */
import { odot, OdotApiError, shareToInstagram } from "/js/odot-client.js";

/* ── 카테고리 매핑 ─────────────────────────────────────────────────── */

const TOPICS = [
  { id: "exercise", name: "운동", color: "red", asset: "assets/category-exercise.png" },
  { id: "study", name: "공부", color: "orange", asset: "assets/category-study.png" },
  { id: "reading", name: "독서", color: "green", asset: "assets/category-reading.png" },
  { id: "music", name: "음악", color: "purple", asset: "assets/category-music.png" },
  { id: "culture", name: "교양", color: "yellow", asset: "assets/category-culture.png" },
  { id: "career", name: "진로", color: "blue", asset: "assets/category-career.png" },
  { id: "etc", name: "기타", color: "gray", asset: "assets/category-misc.png" },
];

const byId = (id) => TOPICS.find((t) => t.id === id) ?? TOPICS[6];
const byName = (name) => TOPICS.find((t) => t.name === name);

/** '1주' → '1w' */
const DURATION_ID = { "1일": "1d", "1주": "1w", "1개월": "1m", "3개월": "3m", "6개월": "6m" };

/* ── 상태 ──────────────────────────────────────────────────────────── */

/** 브리지가 들고 있는 것 — app.html 의 state/Storage 와는 별개 */
const SESSION_KEY = "odot.projectId";

const bridge = {
  ready: false,
  /** 지금 열려 있는 프로젝트(세션) id */
  projectId: null,
  /** 할 일까지 만든 프로젝트 (제목/설명/todo id 를 화면에 붙일 때 쓴다) */
  lastProject: null,
  injectedCategoryNames: new Set(),
};

function rememberSession(projectId) {
  bridge.projectId = projectId;
  try {
    if (projectId) window.localStorage.setItem(SESSION_KEY, projectId);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 저장 실패해도 이번 세션은 동작한다 */
  }
}

function recallSession() {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/**
 * 프로토타입은 renderReview / renderCalendar 를 여러 겹으로 덮어써 놓아서
 * 한 번 그릴 때 같은 조회가 두세 번 나간다. 아주 짧게만 결과를 재사용해
 * 화면 한 번당 요청 한 번으로 줄인다.
 */
function memoizeBriefly(fn, ms = 1500) {
  let key = null;
  let value = null;
  let at = 0;
  return async (...args) => {
    const nextKey = JSON.stringify(args);
    if (key === nextKey && Date.now() - at < ms) return value;
    value = await fn(...args);
    key = nextKey;
    at = Date.now();
    return value;
  };
}

const el = (sel) => document.querySelector(sel);

function toastSafe(message) {
  if (typeof toast === "function") toast(message);
  else console.warn("[odot]", message);
}

/** 서버 에러를 사용자에게 보여줄 문구로 */
function messageOf(err) {
  return err instanceof OdotApiError ? err.message : "잠시 후 다시 시도해주세요.";
}

/* ── 1. 나이 입력 단계 ─────────────────────────────────────────────── */

/**
 * 온보딩을 벗어나는 모든 경로(다음 버튼, 건너뛰기, 하단 탭)를 가로채서
 * 나이를 아직 안 받았으면 나이 입력 화면을 먼저 띄운다.
 */
function installAgeGate() {
  const base = window.showScreen;
  window.showScreen = (id) => {
    if (!bridge.ready && id !== "onboarding") {
      showAgeSlide();
      return;
    }
    base(id);
  };
}

function ensureAgeSlide() {
  let slide = el("#odotAgeSlide");
  if (slide) return slide;

  slide = document.createElement("div");
  slide.className = "onboard-slide";
  slide.id = "odotAgeSlide";
  slide.innerHTML = `
    <p class="eyebrow">시작하기 전에</p>
    <h1>몇 살인지<br>알려 주세요.</h1>
    <p class="sub">나이에 맞는 활동만 추천하려고 물어봐요. 다른 곳에는 쓰지 않아요.</p>
    <div class="custom-wrap">
      <input id="odotAgeInput" type="number" inputmode="numeric" min="5" max="120" placeholder="예: 17">
      <button id="odotAgeSubmit" type="button">확인</button>
    </div>
    <small class="field-help" id="odotAgeHelp">5살부터 120살까지 입력할 수 있어요.</small>
  `;
  document.querySelector(".onboard").append(slide);

  const submit = () => void saveAge();
  slide.querySelector("#odotAgeSubmit").onclick = submit;
  slide.querySelector("#odotAgeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  return slide;
}

function showAgeSlide() {
  const slide = ensureAgeSlide();
  document.querySelectorAll(".onboard-slide").forEach((x) => x.classList.remove("active"));
  slide.classList.add("active");

  // 나이 화면에서는 슬라이드 네비게이션을 감춘다.
  for (const sel of ["#onboardNext", "#onboardSkip", ".dots"]) {
    const node = el(sel);
    if (node) node.hidden = true;
  }
  el("#odotAgeInput")?.focus();
}

async function saveAge() {
  const input = el("#odotAgeInput");
  const help = el("#odotAgeHelp");
  const age = Number(input.value);

  if (!Number.isInteger(age) || age < 5 || age > 120) {
    help.textContent = "5살부터 120살까지 숫자로 입력해 주세요.";
    return;
  }

  const button = el("#odotAgeSubmit");
  button.disabled = true;
  help.textContent = "확인하고 있어요…";

  try {
    await odot.createUser({ age });
    bridge.ready = true;
    await hydrate();
    help.textContent = "";
    for (const sel of ["#onboardNext", "#onboardSkip", ".dots"]) {
      const node = el(sel);
      if (node) node.hidden = false;
    }
    window.showScreen("interests");
  } catch (err) {
    help.textContent = messageOf(err);
  } finally {
    button.disabled = false;
  }
}

/* ── 2. 관심사 단일 선택 ───────────────────────────────────────────── */

/**
 * hidden 속성이 실제로 먹게 만든다.
 *
 * .custom-wrap{display:flex} 처럼 클래스에 display 가 지정돼 있으면
 * hidden 이 주는 display:none(브라우저 기본 스타일)을 이겨버려서 요소가 계속 보인다.
 * 프로토타입이 hidden 을 쓰는 곳(직접 입력란, 하단 탭, 프로젝트 잠금 영역)이
 * 모두 같은 문제를 갖고 있어서 규칙 하나로 한 번에 고친다.
 */
function fixHiddenAttribute() {
  if (document.getElementById("odotHiddenFix")) return;
  const style = document.createElement("style");
  style.id = "odotHiddenFix";
  style.textContent = "[hidden]{display:none !important}";
  document.head.append(style);
}


function installSingleSelectInterests() {
  fixHiddenAttribute();

  // 안내 문구를 1개 선택 기준으로 바꾼다.
  const sub = el("#interests .sub");
  if (sub) sub.textContent = "가장 마음이 가는 한 가지를 골라 주세요. 나중에 언제든 바꿀 수 있어요.";

  window.renderInterests = () => {
    const selected = state.interests[0] ?? null;
    const known = selected ? byName(selected) : null;
    // 7개 중 없는 이름 = 기타에 직접 입력한 값
    const activeName = selected ? (known ? known.name : "기타") : null;
    const isCustom = Boolean(selected) && !known;

    el("#interestChips").innerHTML = TOPICS.map(
      (t) => `<button class="chip ${t.color} ${t.name === activeName ? "selected" : ""}"
        data-interest="${t.name}" aria-pressed="${t.name === activeName}">
        <i class="chip-dot"></i><img src="${t.asset}" alt=""><span>${t.name}</span></button>`,
    ).join("");

    el("#interestCount").textContent = selected ? "1개 선택" : "선택 전";

    // 직접 입력은 '기타'를 골랐을 때만 보여준다.
    const wantsCustom = activeName === "기타";
    for (const sel of ['label[for="customInterest"]', "#interests .custom-wrap", "#customHelp"]) {
      const node = el(sel);
      if (node) node.hidden = !wantsCustom;
    }
    if (wantsCustom && !isCustom) {
      el("#customHelp").textContent = "어떤 관심사인지 적어 주세요. 최대 20자예요.";
    }

    // 기타는 직접 입력까지 마쳐야 다음으로 넘어갈 수 있다.
    el("#startExplore").disabled = !selected || (wantsCustom && !isCustom);

    document.querySelectorAll("[data-interest]").forEach((b) => {
      b.onclick = () => selectInterest(b.dataset.interest);
    });
  };

  function selectInterest(name) {
    state.interests = state.interests[0] === name ? [] : [name];
    window.renderInterests();
    if (name === "기타") el("#customInterest")?.focus();
  }

  // 직접 입력: 누적이 아니라 '기타'의 값으로 교체한다.
  const add = el("#addCustomInterest");
  if (add) {
    add.onclick = () => {
      const input = el("#customInterest");
      const help = el("#customHelp");
      const value = input.value.trim();
      if (value.length < 2) {
        help.textContent = "두 글자 이상 입력해 주세요.";
        return;
      }
      state.interests = [value];
      help.textContent = `'${value}'로 시작할게요.`;
      window.renderInterests();
    };
  }
}

/* ── 3. MockAPI → 실제 백엔드 ──────────────────────────────────────── */

function installRealApi() {
  /**
   * 관심사 확정 = **새 프로젝트(세션) 시작**.
   * 프로토타입의 '관심 분야 선택' 화면이 곧 새 세션을 여는 화면이 된다.
   */
  MockAPI.saveInterests = async (interests) => {
    const name = interests[0];
    if (!name) return;
    const known = byName(name);

    try {
      const { project } = await odot.createProject(
        known && known.id !== "etc"
          ? { topic: known.id }
          : { topic: "etc", customTopic: name },
      );
      rememberSession(project.id);
      syncStorage({ interests: [name], reactions: [], projects: [] });
    } catch (err) {
      const help = el("#customHelp");
      if (help) help.textContent = messageOf(err);
      throw err;
    }
  };

  /** 지금 세션의 카드 덱 (F-OVNIBD) */
  MockAPI.getRecommendations = async () => {
    if (!bridge.projectId) return [];
    try {
      const deck = await odot.getCards(bridge.projectId);
      // 다음 카드들을 미리 만들어 둔다 — 넘길 때 기다리지 않게.
      void odot.prefetch(bridge.projectId).catch(() => undefined);
      return deck.cards.map(toTopic);
    } catch (err) {
      toastSafe(messageOf(err));
      return [];
    }
  };

  /** 스와이프 확정 (F-ZSDXRA) */
  MockAPI.saveReaction = async ({ topicId, category, type }) => {
    try {
      await odot.react(topicId, type);
    } catch (err) {
      if (err instanceof OdotApiError && err.code === "ALREADY_REACTED") return;
      toastSafe(messageOf(err));
      return;
    }

    const data = Storage.read();
    data.reactions.push({ topicId, category, type, at: new Date().toISOString() });
    Storage.write(data);

    // 한 장 넘길 때마다 앞쪽을 채워 둔다 ("2번을 볼 때 6번을 만든다")
    if (bridge.projectId) void odot.prefetch(bridge.projectId).catch(() => undefined);
  };

  /** 관심 키워드를 조합해 할 일 생성 (F-PEBLKV) */
  MockAPI.createProject = async ({ duration }) => {
    if (!bridge.projectId) {
      throw new OdotApiError("NOT_FOUND", "먼저 관심사를 골라 세션을 시작해주세요.");
    }
    const { project } = await odot.createTodos(
      bridge.projectId,
      DURATION_ID[duration] ?? "1w",
    );
    bridge.lastProject = project;

    return {
      id: project.id,
      category: byId(project.topic).name,
      duration,
      title: project.title,
      tasks: project.todos.map((t) => t.content),
    };
  };

  /** 월간 정산 — 프로젝트를 가리지 않고 한 달 전체를 본다 (F-NYHVHG) */
  MockAPI.getReview = memoizeBriefly(async () => {
    const { report } = await odot.getMonthlyReport();
    if (report.isEmpty) return [];

    // 프로토타입의 category(name) 헬퍼가 키워드도 찾을 수 있게 색/에셋을 등록해 둔다.
    clearInjectedCategories();
    for (const k of report.topKeywords) {
      const t = byId(k.category);
      Catalog.categories.unshift({ name: k.keyword, color: t.color, asset: t.asset });
      bridge.injectedCategoryNames.add(k.keyword);
    }

    return report.topKeywords.map((k) => ({
      category: k.keyword,
      count: Math.max(1, k.score),
      change: k.isNew ? "new" : `${k.delta >= 0 ? "+" : ""}${k.delta}`,
    }));
  });

  /** 완료 캘린더 (F-IYXFDA) */
  MockAPI.getCompletions = memoizeBriefly(async () => {
    const month = `${state.calendarMonth.getFullYear()}-${String(state.calendarMonth.getMonth() + 1).padStart(2, "0")}`;
    try {
      const data = await odot.getCalendar(month);
      return data.days.flatMap((day) =>
        day.breakdown.flatMap(({ category, count }) =>
          Array.from({ length: count }, () => ({ date: day.date, category })),
        ),
      );
    } catch (err) {
      toastSafe(messageOf(err));
      return [];
    }
  });
}

/** 서버 카드 → 프로토타입이 그릴 수 있는 모양 */
function toTopic(card) {
  const t = byId(card.category);
  return {
    id: card.id,
    category: t.name,
    color: t.color,
    title: card.keyword,
    intro: card.intro,
    reason: card.reason,
    easy: null, // 위로 스와이프할 때 채운다
  };
}

function clearInjectedCategories() {
  if (bridge.injectedCategoryNames.size === 0) return;
  for (let i = Catalog.categories.length - 1; i >= 0; i--) {
    if (bridge.injectedCategoryNames.has(Catalog.categories[i].name)) {
      Catalog.categories.splice(i, 1);
    }
  }
  bridge.injectedCategoryNames.clear();
}

/* ── 4. 쉬운 요약 미리 받아두기 ────────────────────────────────────── */

/**
 * 프로토타입은 카드를 그릴 때 요약 시트를 미리 채워둔다.
 * 서버는 요약을 카드 목록에 싣지 않으므로(필요할 때만 만든다),
 * 현재 카드가 화면에 뜨는 순간 한 장 분량만 받아온다.
 */
function installSummaryPrefetch() {
  const base = window.renderDeck;
  window.renderDeck = () => {
    base();
    const topic = activeTopic();
    if (!topic || topic.easy) return;

    el("#sheetCopy").textContent = "쉬운 설명을 가져오는 중이에요…";
    odot
      .getCardSummary(topic.id)
      .then(({ summary }) => {
        topic.easy = summary.easySummary;
        if (activeTopic() === topic) el("#sheetCopy").textContent = topic.easy;
      })
      .catch(() => {
        topic.easy = `${topic.title}은(는) ${topic.intro}`;
        if (activeTopic() === topic) el("#sheetCopy").textContent = topic.easy;
      });
  };
}

/* ── 화면 문구 바로잡기 ────────────────────────────────────────────── */

/**
 * 프로토타입에 남아 있는 "더미" 문구를 실제 동작에 맞게 바꾼다.
 *
 * 친구 파일을 그대로 두기 위해 여기서 런타임에 고친다 —
 * app.html 은 원본에 <script> 한 줄만 더한 상태를 유지한다.
 */
function currentMonthLabel() {
  const d = state.calendarMonth ?? new Date();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

/** 프로젝트 생성 중 로딩 문구 */
function fixLoadingCopy() {
  const sub = document.querySelector("#projectOutput .loading .sub");
  if (sub && sub.textContent.includes("더미")) {
    sub.textContent = "관심 키워드를 조합하는 중";
  }
}

/** 정산 화면 머리말 — 연월이 2026년 8월로 고정돼 있었다 */
function installReviewCopyFix() {
  const base = window.renderReview;
  window.renderReview = async () => {
    await base();
    const eyebrow = document.querySelector("#reviewContent .eyebrow");
    if (eyebrow && eyebrow.textContent.includes("더미")) {
      eyebrow.textContent = `${currentMonthLabel()} 정산`;
    }
  };
}

/* ── 5. 할 일 완료 → 서버 저장 ─────────────────────────────────────── */

/**
 * 프로토타입의 완료 체크는 화면 표시만 바꾼다.
 * 캘린더가 실제 기록을 보여주려면 서버에 저장해야 하므로,
 * 생성 직후 각 .task 에 todo id 를 붙이고 체크를 서버로 연결한다.
 */
function installTodoPersistence() {
  const base = window.generateProject;
  window.generateProject = async () => {
    // base() 는 첫 await 전에 로딩 화면을 그린다. 그 직후 문구를 바로잡는다.
    const running = base();
    fixLoadingCopy();
    await running;

    const project = bridge.lastProject;
    if (!project) return;

    // 프로토타입의 todo-card 패스가 제목을 '이번 주, 여기서 시작해요' 로 덮어쓴다.
    // PRD F-PEBLKV 는 "완료되면 프로젝트 제목과 할 일 목록을 표시한다" 이므로 되살린다.
    // (하드코딩된 '이번 주' 라서 6개월을 골라도 '이번 주' 로 나오는 문제도 같이 해결된다)
    const title = document.querySelector(".project-result-head h2");
    if (title && project.title) title.textContent = project.title;

    // AI 가 쓴 한 줄 설명도 제목 아래에 붙인다.
    const head = document.querySelector(".project-result-head");
    if (head && project.description) {
      let desc = head.querySelector(".odot-project-desc");
      if (!desc) {
        desc = document.createElement("p");
        desc.className = "sub odot-project-desc";
        desc.style.cssText = "margin:6px 0 0;font-size:13px;line-height:1.45";
        title?.insertAdjacentElement("afterend", desc);
      }
      desc.textContent = project.description;
    }

    const tasks = [...document.querySelectorAll(".project-result .task")];
    tasks.forEach((node, i) => {
      const todo = project.todos[i];
      if (!todo) return;
      node.dataset.todoId = todo.id;

      // 프로토타입 핸들러가 먼저 붙어 있어서, 여기 오면 completed 클래스는 이미 갱신된 뒤다.
      node.querySelector(".task-check")?.addEventListener("click", () => {
        const isCompleted = node.classList.contains("completed");
        odot
          .updateTodo(todo.id, { isCompleted, category: todo.category })
          .catch((err) => toastSafe(messageOf(err)));
      });
    });
  };

  // 이미 옛 함수로 묶여 있는 버튼을 새 함수로 다시 연결한다.
  const button = el("#makeProject");
  if (button) button.onclick = window.generateProject;
}

/* ── 6. 인스타그램 공유 ────────────────────────────────────────────── */

function installShare() {
  const button = el("#shareBtn");
  if (!button) return;

  button.onclick = async () => {
    const month = `${state.calendarMonth.getFullYear()}-${String(state.calendarMonth.getMonth() + 1).padStart(2, "0")}`;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "이미지를 만드는 중…";

    const result = await shareToInstagram(month);

    button.disabled = false;
    button.textContent = original;
    if (result === "success") toastSafe("공유했어요.");
    else if (result === "no_app") toastSafe("이 기기에서는 공유 기능을 쓸 수 없어요. 인스타그램 앱을 설치해 주세요.");
    else toastSafe("공유하지 못했어요. 다시 시도해 주세요.");
  };
}

/* ── 7. 서버 상태로 화면 채우기 ────────────────────────────────────── */

function syncStorage(patch) {
  const data = Storage.read();
  Object.assign(data, patch);
  Storage.write(data);
}

/**
 * 새로고침해도 화면이 서버 상태를 그대로 반영하도록 맞춘다.
 *
 * 프로토타입의 여러 화면이 Storage 를 직접 읽기 때문에, 지금 열린 세션의
 * 서버 값을 Storage 에 심어준다.
 */
async function hydrate() {
  await odot.getMe();

  // 저장해 둔 세션이 있으면 그걸, 없으면 가장 최근 프로젝트를 이어서 연다.
  let projectId = recallSession();
  if (!projectId) {
    const { projects } = await odot.listProjects().catch(() => ({ projects: [] }));
    projectId = projects[0]?.id ?? null;
  }

  if (!projectId) {
    rememberSession(null);
    state.interests = [];
    syncStorage({ interests: [], reactions: [] });
    return;
  }

  let project;
  let eligibility;
  try {
    const loaded = await odot.getProject(projectId);
    project = loaded.project;
    eligibility = loaded.eligibility;
  } catch (err) {
    // 지워졌거나 남의 것이면 세션을 버리고 새로 시작한다.
    if (err instanceof OdotApiError && ["NOT_FOUND", "FORBIDDEN"].includes(err.code)) {
      rememberSession(null);
      state.interests = [];
      syncStorage({ interests: [], reactions: [] });
      return;
    }
    throw err;
  }

  rememberSession(project.id);

  const label = project.customTopic ?? byId(project.topic).name;
  state.interests = [label];

  // 프로토타입이 Storage 의 like 개수로 잠금 해제를 판단하므로 서버 수치로 채운다.
  syncStorage({
    interests: state.interests,
    reactions: eligibility.likedKeywords.map((keyword) => ({
      type: "like",
      category: label,
      keyword,
    })),
  });
}

/* ── 부팅 ──────────────────────────────────────────────────────────── */

async function boot() {
  // 프로토타입이 2026년 8월로 고정해 둔 캘린더를 이번 달로 맞춘다.
  const now = new Date();
  state.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  installAgeGate();
  installSingleSelectInterests();
  installRealApi();
  installSummaryPrefetch();
  installTodoPersistence();
  installShare();
  installReviewCopyFix();

  try {
    const session = await odot.ensureUser();
    if (session.needsAge) {
      // 나이를 아직 안 받았다 — 온보딩을 보다가 넘어갈 때 나이 화면이 뜬다.
      window.renderInterests();
      return;
    }
    bridge.ready = true;
    await hydrate();
  } catch (err) {
    console.error("[odot] 초기화 실패", err);
    toastSafe(messageOf(err));
    window.renderInterests();
    return;
  }

  window.renderInterests();

  // 이어서 열 세션이 있으면 그 덱을 불러온다.
  if (bridge.projectId) {
    state.deck = await MockAPI.getRecommendations();
    state.current = 0;
    window.renderDeck();
  }
}

boot();
