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

/* ── 1. 로그인 / 회원가입 ───────────────────────────────────────────── */

/**
 * 프로토타입의 로그인 화면(#loginForm)을 실제 계정에 연결한다.
 *
 * 원래는 demo@odot.app / odot1234 를 하드코딩으로 비교하는 목이었다.
 * 여기서 실제 signUp / logIn 으로 바꾸고, 폼에 없는 것 두 가지를 채워 넣는다:
 *   · 회원가입 모드 전환 (프로토타입에는 로그인만 있다)
 *   · 나이 입력 (연령별 콘텐츠 검열의 기준값이라 가입 때 꼭 필요하다)
 */

let authMode = "login"; // "login" | "signup"

function installAuth() {
  const form = el("#loginForm");
  if (!form) return;

  injectAuthExtras(form);
  form.onsubmit = (event) => {
    event.preventDefault();
    void submitAuth();
  };

  // 온보딩을 벗어나는 모든 경로에서, 로그인 전이면 로그인 화면으로 보낸다.
  const base = window.showScreen;
  window.showScreen = (id) => {
    if (!bridge.ready && id !== "onboarding" && id !== "login") {
      base("login");
      return;
    }
    base(id);
  };
}

/** 폼에 없는 것들(나이, 모드 전환)을 프로토타입 CSS 그대로 끼워 넣는다. */
function injectAuthExtras(form) {
  if (el("#odotAgeField")) return;

  const submit = form.querySelector("button[type=submit]");
  if (!submit) return;

  const ageField = document.createElement("div");
  ageField.id = "odotAgeField";
  ageField.hidden = true;
  ageField.innerHTML =
    '<label for="odotAge">나이</label>' +
    '<input id="odotAge" type="number" inputmode="numeric" min="5" max="120" placeholder="예: 17">';
  submit.insertAdjacentElement("beforebegin", ageField);

  const help = document.createElement("p");
  help.className = "demo-account";
  help.id = "odotAuthHelp";
  help.textContent = "나이는 연령에 맞는 활동만 추천하는 데만 써요.";
  help.hidden = true;
  ageField.insertAdjacentElement("afterend", help);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "text-action";
  toggle.id = "odotAuthToggle";
  toggle.onclick = () => setAuthMode(authMode === "login" ? "signup" : "login");
  submit.insertAdjacentElement("afterend", toggle);

  // 데모 계정 안내와 미리 채워진 데모 값은 더 이상 맞지 않는다.
  form.querySelector(".demo-account")?.remove();
  const email = el("#loginEmail");
  const password = el("#loginPassword");
  if (email && email.value === "demo@odot.app") email.value = "";
  if (password && password.value === "odot1234") password.value = "";

  setAuthMode("login");
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";

  const ageField = el("#odotAgeField");
  const help = el("#odotAuthHelp");
  if (ageField) ageField.hidden = !signup;
  if (help) help.hidden = !signup;

  const submit = el("#loginForm")?.querySelector("button[type=submit]");
  if (submit) submit.textContent = signup ? "가입하고 시작하기" : "로그인하고 시작하기";

  const toggle = el("#odotAuthToggle");
  if (toggle) toggle.textContent = signup ? "이미 계정이 있어요. 로그인" : "처음이신가요? 회원가입";

  const password = el("#loginPassword");
  if (password) {
    password.autocomplete = signup ? "new-password" : "current-password";
    password.placeholder = signup ? "8자 이상" : "";
  }
}

async function submitAuth() {
  const email = el("#loginEmail").value.trim();
  const password = el("#loginPassword").value;
  const submit = el("#loginForm").querySelector("button[type=submit]");
  const label = submit.textContent;

  if (!email || !password) {
    toastSafe("이메일과 비밀번호를 입력해 주세요.");
    return;
  }

  let age;
  if (authMode === "signup") {
    age = Number(el("#odotAge").value);
    if (!Number.isInteger(age) || age < 5 || age > 120) {
      toastSafe("나이를 5살부터 120살 사이로 입력해 주세요.");
      return;
    }
    if (password.length < 8) {
      toastSafe("비밀번호는 8자 이상이어야 해요.");
      return;
    }
  }

  submit.disabled = true;
  submit.textContent = authMode === "signup" ? "가입하는 중…" : "로그인하는 중…";

  try {
    const result =
      authMode === "signup"
        ? await odot.signUp({ email, password, age })
        : await odot.logIn({ email, password });

    bridge.ready = true;
    // 프로토타입 내부 상태도 로그인됨으로 맞춰 준다.
    writeProfile({
      signedIn: true,
      email: result.user.email,
      name: result.user.displayName,
      notifications: result.user.notifications,
    });

    await hydrate();
    window.renderInterests();
    window.showScreen(state.interests.length ? "explore" : "interests");
    toastSafe(`${result.user.displayName}님, 반가워요.`);
  } catch (err) {
    if (err instanceof OdotApiError && err.code === "INVALID_CREDENTIALS") {
      toastSafe("이메일 또는 비밀번호를 확인해 주세요. 처음이면 회원가입을 눌러 주세요.");
    } else if (err instanceof OdotApiError && err.code === "EMAIL_TAKEN") {
      toastSafe("이미 가입된 이메일이에요. 로그인해 주세요.");
      setAuthMode("login");
    } else {
      toastSafe(messageOf(err));
    }
  } finally {
    submit.disabled = false;
    submit.textContent = label;
  }
}

/* ── 로그아웃 · 프로필 ─────────────────────────────────────────────── */

/**
 * 프로필 화면은 renderProfile() 이 매번 innerHTML 로 다시 그리면서 핸들러를
 * 새로 건다. 그래서 렌더가 끝난 뒤에 우리 것으로 덮어써야 한다.
 */
function installProfile() {
  const base = window.renderProfile;
  if (typeof base !== "function") return;

  window.renderProfile = () => {
    base();

    const email = el("#profileEmail");
    if (email) {
      // 계정 이메일은 로그인 신원이라 프로필에서 바꾸지 않는다.
      email.readOnly = true;
      email.title = "계정 이메일은 변경할 수 없어요.";
    }

    const save = el("#saveProfile");
    if (save) save.onclick = () => void saveProfile();

    const logout = el("#logout");
    if (logout) logout.onclick = () => void doLogout();
  };
}

async function saveProfile() {
  const name = el("#profileName")?.value.trim();
  const notifications = el("#notificationToggle")?.checked ?? true;
  if (!name) {
    toastSafe("이름을 입력해 주세요.");
    return;
  }

  try {
    const me = await odot.updateProfile({ displayName: name, notifications });
    writeProfile({ name: me.user.displayName, notifications: me.user.notifications });
    toastSafe("프로필을 저장했어요.");
    window.renderProfile();
  } catch (err) {
    toastSafe(messageOf(err));
  }
}

async function doLogout() {
  try {
    await odot.logOut();
  } catch {
    // 서버 응답과 무관하게 로컬 상태는 정리한다.
  }
  bridge.ready = false;
  rememberSession(null);
  writeProfile({ signedIn: false });
  state.interests = [];
  state.deck = [];
  state.current = 0;
  syncStorage({ interests: [], reactions: [] });
  window.showScreen("login");
  toastSafe("로그아웃했어요.");
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

    // 직접 입력한 주제는 첫 덱부터 AI 가 만들어서 몇 초 걸린다.
    const start = el("#startExplore");
    const startLabel = start?.textContent;
    if (start) {
      start.disabled = true;
      start.textContent = known ? "카드를 준비하는 중…" : "주제에 맞는 카드를 만드는 중…";
    }

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
    } finally {
      if (start) {
        start.disabled = false;
        start.textContent = startLabel;
      }
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

    // 한 장 넘길 때마다: 이미 만들어진 카드를 먼저 당겨오고,
    // 서버에 다음 카드를 만들게 한 뒤 그 결과도 덱에 반영한다.
    // ("2번을 볼 때 6번을 만든다")
    if (bridge.projectId) {
      void (async () => {
        await topUpDeck();
        await odot.prefetch(bridge.projectId).catch(() => undefined);
        await topUpDeck();
      })();
    }
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

/* ── 프로젝트 목록 (친구의 #projects 화면을 실제 데이터에 연결) ────────── */

/**
 * 프로토타입이 자체 프로젝트 목록 화면을 갖게 되면서, 브리지가 따로 만들던
 * '내 프로젝트' 화면은 필요 없어졌다. 대신 친구 화면을 실제 데이터로 채운다.
 *
 * 프로토타입 쪽은 state.activeProjectPicks(로컬 결정 플로우) 기준으로 그리는데,
 * 그 흐름이 아직 목이라 목록이 늘 비어 보인다. 서버 목록이 있으면 그걸 우선한다.
 */

const STATUS_LABEL = {
  collecting: "카드 모으는 중",
  generating: "할 일 만드는 중",
  ready: "할 일 준비됨",
  failed: "생성 실패",
};

function installProjectList() {
  injectProjectListStyles();

  const base = window.renderProjects;
  window.renderProjects = () => {
    base();
    void renderRealProjects();
  };
}

function injectProjectListStyles() {
  if (document.getElementById("odotProjectListStyles")) return;
  const style = document.createElement("style");
  style.id = "odotProjectListStyles";
  style.textContent = `
    .odot-project-list{display:flex;flex-direction:column;gap:10px;margin:14px 0 4px}
    .odot-project{--sc:var(--gray);display:flex;gap:12px;align-items:center;width:100%;
      padding:14px 15px;border:1px solid var(--line);border-radius:20px;background:#fff;
      text-align:left;position:relative;overflow:hidden}
    .odot-project:after{content:"";position:absolute;right:-26px;bottom:-30px;width:78px;height:78px;
      border-radius:48% 52% 44% 56%;background:color-mix(in srgb,var(--sc) 13%,white)}
    .odot-project > *{position:relative;z-index:1}
    .odot-project img{width:42px;height:42px;object-fit:contain;flex:none}
    .odot-project .body{flex:1;min-width:0}
    .odot-project .name{font-size:15px;font-weight:800;letter-spacing:-.3px;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .odot-project .meta{margin-top:3px;color:var(--muted);font-size:12px;font-weight:700}
    .odot-project .now{flex:none;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;
      background:var(--primary);color:#fff}
    .odot-project.current{border-color:var(--primary);box-shadow:0 6px 18px #6e34cc1f}
    .odot-project-new{width:100%;margin-top:6px;padding:14px;border:1px dashed #d8cec0;
      border-radius:20px;background:#fff;color:var(--primary);font-size:14px;font-weight:800}
  `;
  document.head.append(style);
}

async function renderRealProjects() {
  if (!bridge.ready) return;

  const ready = el("#projectReady");
  if (!ready) return;

  let projects = [];
  try {
    ({ projects } = await odot.listProjects());
  } catch {
    return; // 실패하면 프로토타입이 그린 화면을 그대로 둔다.
  }

  const signal = el("#projectSignal");
  const eyebrow = el("#projects > .eyebrow");
  const title = el("#projects > h1");
  if (signal) signal.textContent = `프로젝트 ${projects.length}개`;
  if (eyebrow) eyebrow.textContent = "각 목표를 각자의 속도로";

  if (projects.length === 0) {
    if (title) title.innerHTML = "아직 시작한<br>프로젝트가 없어요.";
    // 프로토타입의 빈 상태를 그대로 두되, 버튼만 새 프로젝트로 연결한다.
    const find = el("#findGoal");
    if (find) find.onclick = () => startNewProject();
    return;
  }

  if (title) title.innerHTML = "어떤 걸<br>이어서 해볼까요?";
  el("#projectLocked")?.setAttribute("hidden", "");
  ready.hidden = false;

  ready.innerHTML =
    '<div class="odot-project-list">' +
    projects
      .map((p) => {
        const t = byId(p.topic);
        const name = p.title ?? `${p.customTopic ?? t.name} 탐색`;
        const meta = [
          `관심 ${p.likeCount}개`,
          `카드 ${p.reactionCount}장`,
          STATUS_LABEL[p.status] ?? p.status,
        ].join(" · ");
        const current = p.id === bridge.projectId;
        return `<button class="odot-project ${current ? "current" : ""}" data-project="${p.id}"
          style="--sc:var(--${t.color})" type="button">
          <img src="${t.asset}" alt="">
          <span class="body"><span class="name">${escapeHtml(name)}</span><span class="meta">${meta}</span></span>
          ${current ? '<span class="now">보는 중</span>' : ""}
        </button>`;
      })
      .join("") +
    "</div>" +
    '<button class="odot-project-new" id="odotNewProject" type="button">+ 새 프로젝트 시작하기</button>';

  ready.querySelectorAll("[data-project]").forEach((node) => {
    node.onclick = () => void openSession(node.dataset.project);
  });
  el("#odotNewProject").onclick = () => startNewProject();
}

/** 관심사 선택 화면이 곧 '새 프로젝트' 화면이다. */
function startNewProject() {
  state.interests = [];
  window.renderInterests();
  window.showScreen("interests");
}

/** 다른 프로젝트로 갈아탄다. 덱과 관심 이력이 그 프로젝트 것으로 완전히 바뀐다. */
async function openSession(projectId) {
  if (!projectId) return;
  try {
    const { project, eligibility } = await odot.getProject(projectId);
    rememberSession(project.id);

    const label = project.customTopic ?? byId(project.topic).name;
    state.interests = [label];
    syncStorage({
      interests: state.interests,
      reactions: eligibility.likedKeywords.map((keyword) => ({
        type: "like",
        category: label,
        keyword,
      })),
    });

    // 이전 세션의 덱을 완전히 버리고 이 프로젝트 것으로 채운다.
    state.deck = await MockAPI.getRecommendations();
    state.current = 0;
    window.renderInterests();
    window.renderDeck();
    window.showScreen("explore");
  } catch (err) {
    toastSafe(messageOf(err));
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/* ── 덱 보충 ───────────────────────────────────────────────────────── */

/**
 * 로컬 덱(state.deck)에 서버 카드를 이어 붙인다.
 *
 * prefetch 는 서버에 카드를 '만들게' 할 뿐이라, 만들어진 카드를 화면으로
 * 가져오는 건 별개다. 이게 없으면 처음 받은 5장을 다 넘긴 순간
 * "오늘의 추천을 모두 살펴봤어요" 빈 상태로 빠져 버린다.
 */
const DECK_TAIL_MIN = 3;
const TOPUP_COOLDOWN_MS = 1500;

let toppingUp = false;
let lastTopUpAt = 0;

async function topUpDeck({ force = false } = {}) {
  if (!bridge.projectId || toppingUp) return 0;

  const tail = state.deck.length - state.current;
  if (!force && tail > DECK_TAIL_MIN) return 0;
  if (!force && Date.now() - lastTopUpAt < TOPUP_COOLDOWN_MS) return 0;

  toppingUp = true;
  try {
    const deck = await odot.getCards(bridge.projectId, 20);
    lastTopUpAt = Date.now();

    const known = new Set(state.deck.map((c) => c.id));
    const fresh = deck.cards.filter((c) => !known.has(c.id)).map(toTopic);
    if (fresh.length === 0) return 0;

    const wasEmpty = state.current >= state.deck.length;
    state.deck.push(...fresh);
    // 빈 상태 화면을 보고 있었다면 새 카드로 바로 바꿔 준다.
    if (wasEmpty) window.renderDeck();
    return fresh.length;
  } catch (err) {
    console.error("[odot] 덱 보충 실패", err);
    return 0;
  } finally {
    toppingUp = false;
  }
}

/** 덱이 비었는데 서버도 아직 준비 중일 때 보여줄 안내 */
function showDeckPendingCard() {
  const card = el("#activeCard");
  if (!card) return;
  card.innerHTML =
    '<div class="empty"><strong>새 카드를 만드는 중이에요.</strong>' +
    "<p>잠시만 기다려 주세요.</p></div>";
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

    if (!topic) {
      // 덱이 비었다 — 서버에 남은 카드를 즉시 가져온다.
      if (toppingUp) showDeckPendingCard();
      else
        void topUpDeck({ force: true }).then((added) => {
          if (added === 0 && bridge.projectId) {
            // 서버도 비었으면 만들게 하고, 만들어지면 반영한다.
            showDeckPendingCard();
            void odot
              .prefetch(bridge.projectId)
              .then(() => topUpDeck({ force: true }))
              .then((n) => {
                if (n === 0) base(); // 그래도 없으면 원래 빈 상태로 되돌린다
              })
              .catch(() => base());
          }
        });
      return;
    }

    // 꼬리가 짧아지면 미리 이어 붙인다.
    void topUpDeck();

    if (topic.easy) return;

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

  installAuth();
  installProfile();
  installSingleSelectInterests();
  installRealApi();
  installSummaryPrefetch();
  installTodoPersistence();
  installShare();
  installReviewCopyFix();
  installProjectList();

  try {
    if (!odot.isLoggedIn()) {
      // 아직 로그인 전 — 온보딩을 벗어나면 로그인 화면이 뜬다.
      window.renderInterests();
      return;
    }
    await odot.getMe(); // 토큰이 아직 유효한지 확인
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
