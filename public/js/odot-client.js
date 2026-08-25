/**
 * odot 브라우저용 API 클라이언트 (빌드 불필요).
 *
 *   <script type="module">
 *     import { odot } from "/js/odot-client.js";
 *
 *     await odot.signUp({ email, password, age: 17 });          // 회원가입
 *     await odot.logIn({ email, password });                    // 로그인
 *     const { project, deck } = await odot.createProject({ topic: "study" });
 *     await odot.react(deck.cards[0].id, "like");               // 오른쪽 스와이프
 *     void odot.prefetch(project.id);                           // 다음 카드 미리 만들기
 *   </script>
 *
 * 프로젝트는 하나의 세션이다. 카드 덱과 스와이프 이력이 그 프로젝트 안에만 쌓이고,
 * 다른 프로젝트를 열면 완전히 새 데이터로 시작한다.
 *
 * 로그인 세션은 localStorage("odot.session") 에 저장되고, 모든 요청에
 * Authorization: Bearer 헤더로 자동으로 실린다.
 * 액세스 토큰이 만료되면 리프레시 토큰으로 알아서 갱신하고 요청을 다시 보낸다.
 *
 * 이 파일은 src/lib/odot-client.ts 와 같은 API 를 제공한다.
 * 타입이 필요하면 src/types/api.ts 를 보면 된다.
 */

const STORAGE_KEY = "odot.deviceId";
const SESSION_KEY = "odot.session";

/**
 * 백엔드가 다른 주소에 있으면 HTML 에서 미리 지정한다:
 *   <script>window.ODOT_API_BASE = "https://odot.example.com";</script>
 */
const BASE = typeof window !== "undefined" && window.ODOT_API_BASE ? window.ODOT_API_BASE : "";

export class OdotApiError extends Error {
  constructor(code, message, details, status) {
    super(message);
    this.name = "OdotApiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function getDeviceId() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setDeviceId(deviceId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, deviceId);
  } catch {
    /* 사파리 프라이빗 모드 등 — 저장 실패해도 이번 세션은 동작한다 */
  }
}

export function clearDeviceId() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 무시 */
  }
}

/* ── 로그인 세션 ────────────────────────────────────────────────────── */

export function getSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(session) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* 저장 실패해도 이번 세션은 동작한다 */
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 무시 */
  }
}

export function isLoggedIn() {
  return getSession() !== null;
}

/** 만료된 액세스 토큰을 리프레시 토큰으로 갱신한다. 실패하면 세션을 버린다. */
async function renewSession() {
  const current = getSession();
  if (!current?.refreshToken) return null;
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    const payload = await res.json();
    if (!payload || payload.ok !== true) {
      clearSession();
      return null;
    }
    setSession(payload.data.session);
    return payload.data.session;
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const { auth = true, method = "GET", body, retried = false } = options;

  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const session = getSession();
    if (session) headers.Authorization = `Bearer ${session.accessToken}`;
    else {
      // 로그인 전 과도기 경로. 로그인 화면이 붙으면 사라진다.
      const deviceId = getDeviceId();
      if (deviceId) headers["x-device-id"] = deviceId;
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    throw new OdotApiError("INTERNAL", "서버 응답을 읽지 못했습니다.", undefined, res.status);
  }

  if (!payload || payload.ok !== true) {
    const err = payload?.error ?? {};
    // 액세스 토큰이 만료된 것뿐이면 갱신해서 한 번만 다시 시도한다.
    if (err.code === "UNAUTHENTICATED" && auth && !retried && getSession()) {
      const renewed = await renewSession();
      if (renewed) return request(path, { ...options, retried: true });
    }
    throw new OdotApiError(
      err.code ?? "INTERNAL",
      err.message ?? "요청을 처리하지 못했습니다.",
      err.details,
      res.status,
    );
  }
  return payload.data;
}

export const odot = {
  /* ── 계정 ───────────────────────────────────────────────── */

  /** 저장된 세션이 있는지. 토큰 유효성까지 보려면 getMe() 를 부른다. */
  isLoggedIn,

  /** 회원가입. 성공하면 바로 로그인된 상태가 된다. */
  async signUp({ email, password, age }) {
    const data = await request("/api/auth/signup", {
      method: "POST",
      auth: false,
      body: { email, password, age },
    });
    setSession(data.session);
    clearDeviceId();
    return data;
  },

  /** 로그인 */
  async logIn({ email, password }) {
    const data = await request("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    });
    setSession(data.session);
    clearDeviceId();
    return data;
  },

  /** 로그아웃. 저장된 토큰도 함께 지운다. */
  async logOut() {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } finally {
      clearSession();
    }
  },

  /* ── 사용자 ─────────────────────────────────────────────── */

  /** @deprecated 로그인 전 과도기 경로. 기기 단위라 같은 브라우저면 같은 사용자다. */
  async createUser({ age }) {
    const data = await request("/api/users/anonymous", {
      method: "POST",
      auth: false,
      body: { deviceId: getDeviceId() ?? undefined, age },
    });
    if (data.user.deviceId) setDeviceId(data.user.deviceId);
    return data;
  },

  /**
   * 앱 시작 시 한 번 부르면 되는 헬퍼.
   * 기기가 이미 등록돼 있으면 그대로 쓰고, 처음이면 needsAge:true 를 돌려준다.
   */
  async ensureUser(age) {
    if (getSession()) {
      try {
        const me = await odot.getMe();
        return { ...me, needsAge: false, isNew: false, loggedIn: true };
      } catch (err) {
        if (!(err instanceof OdotApiError) || err.code !== "UNAUTHENTICATED") throw err;
        clearSession();
      }
    }
    if (getDeviceId()) {
      try {
        const me = await odot.getMe();
        return { ...me, needsAge: false, isNew: false };
      } catch (err) {
        if (!(err instanceof OdotApiError) || err.code !== "USER_NOT_FOUND") throw err;
        clearDeviceId();
      }
    }
    if (age === undefined || age === null) {
      return { user: null, stats: null, needsAge: true, isNew: true };
    }
    const created = await odot.createUser({ age });
    return { ...created, stats: null, needsAge: false };
  },

  getMe: () => request("/api/me"),

  updateAge: (age) => request("/api/me", { method: "PATCH", body: { age } }),

  /** 프로필 수정 (이름 · 알림 · 나이). 준 값만 바뀐다. */
  updateProfile: (patch) => request("/api/me", { method: "PATCH", body: patch }),

  /* ── 관심사 주제 ────────────────────────────────────────── */

  getTopics: () => request("/api/topics", { auth: false }),

  /* ── 프로젝트 = 세션 ────────────────────────────────────── */

  /** 대화 목록처럼 쓰는 프로젝트 목록 (최근 활동 순) */
  listProjects: () => request("/api/projects"),

  /** 새 세션. 관심사 하나를 고르면 프로젝트와 첫 카드 덱이 함께 온다. */
  createProject: ({ topic, customTopic }) =>
    request("/api/projects", { method: "POST", body: { topic, customTopic } }),

  /** 기존 세션 열기 */
  getProject: (projectId) => request(`/api/projects/${projectId}`),

  getEligibility: (projectId) => request(`/api/projects/${projectId}/eligibility`),

  /* ── 카드 ───────────────────────────────────────────────── */

  getCards: (projectId, limit) =>
    request(`/api/projects/${projectId}/cards${limit ? `?limit=${limit}` : ""}`),

  /**
   * 앞으로 볼 카드를 미리 만들어 둔다. 카드를 넘길 때마다 부르면 된다.
   * 응답을 기다릴 필요 없다 — `void odot.prefetch(projectId)` 로 던져두면 된다.
   */
  prefetch: (projectId, lookahead) =>
    request(`/api/projects/${projectId}/cards/prefetch`, {
      method: "POST",
      body: lookahead ? { lookahead } : {},
    }),

  /** "like" = 오른쪽 · "pass" = 왼쪽 · "detail" = 위(쉬운 요약 동봉) */
  react: (cardId, reaction) =>
    request(`/api/cards/${cardId}/reaction`, { method: "POST", body: { reaction } }),

  getCardSummary: (cardId) => request(`/api/cards/${cardId}/summary`),

  /* ── 할 일 후보군 ───────────────────────────────────────── */

  /** 관심 키워드 + 설문 답변으로 목표 후보를 받는다. */
  createGoals: (projectId, answers, count) =>
    request(`/api/projects/${projectId}/goals`, {
      method: "POST",
      body: count ? { answers, count } : { answers },
    }),

  /* ── 할 일 ──────────────────────────────────────────────── */

  /** 관심 키워드를 조합해 할 일 생성. 다시 부르면 재생성. 몇 초 걸린다. */
  createTodos: (projectId, duration, goal) =>
    request(`/api/projects/${projectId}/todos`, {
      method: "POST",
      body: goal ? { duration, goal } : { duration },
    }),

  /** 할 일 직접 추가 */
  addTodo: (input) => request("/api/todos", { method: "POST", body: input }),

  /** 지금 목록을 두고 뒤에 이어질 할 일을 AI 로 더 받는다 */
  suggestTodos: (projectId, count) =>
    request(`/api/projects/${projectId}/todos/suggest`, {
      method: "POST",
      body: count ? { count } : {},
    }),

  updateTodo: (todoId, patch) => request(`/api/todos/${todoId}`, { method: "PATCH", body: patch }),

  /* ── 캘린더 ─────────────────────────────────────────────── */

  getCalendar: (month) => request(`/api/calendar${month ? `?month=${month}` : ""}`),

  getCalendarDay: (date) => request(`/api/calendar/${date}`),

  /* ── 월간 정산 / 공유 ───────────────────────────────────── */

  getMonthlyReport: (month) =>
    request(`/api/reports/monthly${month ? `?month=${month}` : ""}`),

  async getShareImage(month) {
    // 이미지 요청도 다른 API 와 같은 인증을 써야 한다.
    const session = getSession();
    const deviceId = session ? null : getDeviceId();
    const headers = session
      ? { Authorization: `Bearer ${session.accessToken}` }
      : deviceId
        ? { "x-device-id": deviceId }
        : {};
    const res = await fetch(`${BASE}/api/reports/monthly/${month}/image`, { headers });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new OdotApiError(
        payload?.error?.code ?? "INTERNAL",
        payload?.error?.message ?? "공유 이미지를 만들지 못했습니다.",
        undefined,
        res.status,
      );
    }
    return res.blob();
  },

  logShare: (month, result) =>
    request(`/api/reports/monthly/${month}/share`, { method: "POST", body: { result } }),

  /* ── 이벤트 ─────────────────────────────────────────────── */

  logEvent: (type, payload) => request("/api/events", { method: "POST", body: { type, payload } }),
};

/**
 * 인스타그램 공유를 한 번에 처리한다.
 * "success" | "no_app" | "failed" 중 하나를 돌려준다.
 */
export async function shareToInstagram(month) {
  let result = "requested";
  try {
    const blob = await odot.getShareImage(month);
    const file = new File([blob], `odot-${month}.png`, { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: `odot ${month} 관심사 정산` });
      result = "success";
    } else {
      result = "no_app";
    }
  } catch {
    result = "failed";
  }

  await odot.logShare(month, result).catch(() => undefined);
  return result;
}

/**
 * 공유 이미지를 화면에 미리 보여줄 때 쓴다.
 * <img src> 로는 x-device-id 헤더를 실을 수 없어서 blob URL 로 바꿔 넣어야 한다.
 */
export async function attachShareImage(imgElement, month) {
  const blob = await odot.getShareImage(month);
  const url = URL.createObjectURL(blob);
  imgElement.src = url;
  return () => URL.revokeObjectURL(url);
}
