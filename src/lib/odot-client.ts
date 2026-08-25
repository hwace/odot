/**
 * 프론트엔드용 타입 안전 API 클라이언트.
 *
 * 브라우저에서만 쓴다.
 *
 *   import { odot } from "@/lib/odot-client";
 *
 *   await odot.createUser({ age: 17 });                     // 첫 실행 (기기 등록)
 *   const { project, deck } = await odot.createProject({ topic: "study" });
 *   await odot.react(deck.cards[0].id, "like");             // 오른쪽 스와이프
 *   void odot.prefetch(project.id);                         // 다음 카드 미리 만들기
 *
 * deviceId 는 localStorage("odot.deviceId") 에 저장되고, 모든 요청에
 * x-device-id 헤더로 자동으로 실린다.
 *
 * 프로젝트는 하나의 세션이다 — 카드 덱과 스와이프 이력이 프로젝트 안에만 쌓이고,
 * 다른 프로젝트를 열면 완전히 새 데이터로 시작한다.
 *
 * 실패하면 OdotApiError 를 던진다. err.code 로 분기하면 된다:
 *   NOT_ENOUGH_SIGNAL → 카드를 더 넘기라고 안내
 *   AI_FAILED         → "다시 만들기" 버튼 노출
 */
import type {
  ApiErrorCode,
  ApiResponse,
  AuthResult,
  Session,
  CalendarDayDetail,
  CalendarMonth,
  CardDeck,
  CardSummary,
  GoalCandidates,
  MeResponse,
  MonthlyReport,
  Project,
  ProjectDuration,
  ProjectEligibility,
  ProjectSummary,
  ProjectTodo,
  ReactionResult,
  ReactionType,
  ShareLog,
  ShareResult,
  TopicId,
  TopicOption,
  User,
} from "@/types/api";

const STORAGE_KEY = "odot.deviceId";
const SESSION_KEY = "odot.session";

/** 백엔드가 다른 오리진에 있으면 NEXT_PUBLIC_API_BASE_URL 로 지정한다. */
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class OdotApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OdotApiError";
  }
}

export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setDeviceId(deviceId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, deviceId);
}

export function clearDeviceId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/* ── 세션 저장소 ────────────────────────────────────────────────────── */

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(session: Session): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
}

export function isLoggedIn(): boolean {
  return getSession() !== null;
}

/** 만료된 액세스 토큰을 리프레시 토큰으로 갱신한다. 실패하면 세션을 버린다. */
async function renewSession(): Promise<Session | null> {
  const current = getSession();
  if (!current?.refreshToken) return null;
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    const body = (await res.json()) as ApiResponse<{ session: Session }>;
    if (!body.ok) {
      clearSession();
      return null;
    }
    setSession(body.data.session);
    return body.data.session;
  } catch {
    return null;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean; retried?: boolean } = {},
): Promise<T> {
  const { auth = true, retried = false, headers, ...rest } = init;
  const merged = new Headers(headers);
  merged.set("Content-Type", "application/json");

  if (auth) {
    const session = getSession();
    if (session) merged.set("Authorization", `Bearer ${session.accessToken}`);
    else {
      // 로그인 전 과도기 경로. 로그인 화면이 붙으면 사라진다.
      const deviceId = getDeviceId();
      if (deviceId) merged.set("x-device-id", deviceId);
    }
  }

  const res = await fetch(`${BASE}${path}`, { ...rest, headers: merged });
  const body = (await res.json()) as ApiResponse<T>;

  if (!body.ok) {
    // 액세스 토큰이 만료된 것뿐이면 갱신해서 한 번만 다시 시도한다.
    if (body.error.code === "UNAUTHENTICATED" && auth && !retried && getSession()) {
      const renewed = await renewSession();
      if (renewed) return request<T>(path, { ...init, retried: true });
    }
    throw new OdotApiError(body.error.code, body.error.message, body.error.details, res.status);
  }
  return body.data;
}

const json = (body: unknown) => JSON.stringify(body);

export const odot = {
  /* ── 계정 ───────────────────────────────────────────────── */

  /** 저장된 세션이 있는지. 토큰 유효성까지 보려면 getMe() 를 부른다. */
  isLoggedIn,

  /** 회원가입. 성공하면 바로 로그인된 상태가 된다. */
  async signUp(input: { email: string; password: string; age: number }): Promise<AuthResult> {
    const data = await request<AuthResult>("/api/auth/signup", {
      method: "POST",
      auth: false,
      body: json(input),
    });
    setSession(data.session);
    clearDeviceId();
    return data;
  },

  /** 로그인 */
  async logIn(input: { email: string; password: string }): Promise<AuthResult> {
    const data = await request<AuthResult>("/api/auth/login", {
      method: "POST",
      auth: false,
      body: json(input),
    });
    setSession(data.session);
    clearDeviceId();
    return data;
  },

  /** 로그아웃. 저장된 토큰도 함께 지운다. */
  async logOut(): Promise<void> {
    try {
      await request<{ loggedOut: true }>("/api/auth/logout", { method: "POST" });
    } finally {
      clearSession();
    }
  },

  /* ── 사용자 ─────────────────────────────────────────────── */

  /**
   * @deprecated 로그인 화면이 붙기 전까지의 과도기 경로.
   * 기기 단위라 같은 브라우저를 쓰면 같은 사용자가 된다.
   */
  async createUser(input: { age: number }): Promise<{ user: User; isNew: boolean }> {
    const data = await request<{ user: User; isNew: boolean }>("/api/users/anonymous", {
      method: "POST",
      auth: false,
      body: json({ deviceId: getDeviceId() ?? undefined, age: input.age }),
    });
    if (data.user.deviceId) setDeviceId(data.user.deviceId);
    return data;
  },

  getMe: () => request<MeResponse>("/api/me"),

  /** 나이 수정. 연령 정책이 바로 다시 적용된다. */
  updateAge: (age: number) =>
    request<MeResponse>("/api/me", { method: "PATCH", body: json({ age }) }),

  /** 프로필 수정 (이름 · 알림 · 나이). 준 값만 바뀐다. */
  updateProfile: (patch: { displayName?: string; notifications?: boolean; age?: number }) =>
    request<MeResponse>("/api/me", { method: "PATCH", body: json(patch) }),

  /* ── 관심사 주제 ────────────────────────────────────────── */

  getTopics: () => request<{ topics: TopicOption[] }>("/api/topics", { auth: false }),

  /* ── 프로젝트 = 세션 ────────────────────────────────────── */

  /** 대화 목록처럼 쓰는 프로젝트 목록 (최근 활동 순) */
  listProjects: () => request<{ projects: ProjectSummary[] }>("/api/projects"),

  /**
   * 새 세션을 연다. 관심사 하나를 고르면 프로젝트와 **첫 카드 덱이 함께** 온다.
   * 첫 덱은 트렌드 키워드라 AI 생성을 기다리지 않는다.
   */
  createProject: (input: { topic: TopicId; customTopic?: string }) =>
    request<{ project: Project; deck: CardDeck }>("/api/projects", {
      method: "POST",
      body: json(input),
    }),

  /** 기존 세션을 연다. 프로젝트 + 할 일 + 진행 상황이 온다. */
  getProject: (projectId: string) =>
    request<{ project: Project; eligibility: ProjectEligibility }>(
      `/api/projects/${projectId}`,
    ),

  /** 프로젝트 이름 바꾸기 (같은 카테고리끼리 구분용) */
  renameProject: (projectId: string, title: string) =>
    request<{ project: Project }>(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: json({ title }),
    }),

  getEligibility: (projectId: string) =>
    request<ProjectEligibility>(`/api/projects/${projectId}/eligibility`),

  /* ── 카드 ───────────────────────────────────────────────── */

  getCards: (projectId: string, limit?: number) =>
    request<CardDeck>(
      `/api/projects/${projectId}/cards${limit ? `?limit=${limit}` : ""}`,
    ),

  /**
   * 앞으로 볼 카드를 미리 만들어 둔다. 카드를 넘길 때마다 부르면 된다.
   * 응답을 기다릴 필요 없다 — `void odot.prefetch(projectId)` 로 던져두면 된다.
   */
  prefetch: (projectId: string, lookahead?: number) =>
    request<{ remaining: number; generated: number }>(
      `/api/projects/${projectId}/cards/prefetch`,
      { method: "POST", body: json(lookahead ? { lookahead } : {}) },
    ),

  /** 스와이프 확정. 위로 스와이프(detail)면 summary 가 함께 온다. */
  react: (cardId: string, reaction: ReactionType) =>
    request<ReactionResult>(`/api/cards/${cardId}/reaction`, {
      method: "POST",
      body: json({ reaction }),
    }),

  getCardSummary: (cardId: string) =>
    request<{ summary: CardSummary }>(`/api/cards/${cardId}/summary`),

  /* ── 할 일 후보군 ───────────────────────────────────────── */

  /**
   * 관심 키워드 + 설문 답변으로 목표 후보를 받는다.
   * 사용자가 하나 고르면 createTodos 로 실제 할 일을 만든다.
   */
  createGoals: (
    projectId: string,
    answers: Array<{ question: string; answer: string }>,
    count?: number,
  ) =>
    request<GoalCandidates>(`/api/projects/${projectId}/goals`, {
      method: "POST",
      body: json(count ? { answers, count } : { answers }),
    }),

  /* ── 할 일 ──────────────────────────────────────────────── */

  /**
   * 이 프로젝트에서 모은 관심 키워드를 조합해 할 일을 만든다.
   * 다시 부르면 재생성된다 (실패 시 "다시 만들기"도 같은 호출).
   * 응답까지 몇 초 걸린다.
   */
  createTodos: (
    projectId: string,
    duration: ProjectDuration,
    goal?: { title: string; why?: string },
  ) =>
    request<{ project: Project }>(`/api/projects/${projectId}/todos`, {
      method: "POST",
      body: json(goal ? { duration, goal } : { duration }),
    }),

  /** 할 일 직접 추가 (프로젝트 상세에서 손으로 적어 넣기) */
  addTodo: (input: {
    projectId: string;
    content: string;
    category?: string;
    recommendedAt?: string;
  }) => request<{ todo: ProjectTodo }>("/api/todos", { method: "POST", body: json(input) }),

  /** 지금 목록을 두고 뒤에 이어질 할 일을 AI 로 더 받는다 */
  suggestTodos: (projectId: string, count?: number) =>
    request<{ todos: ProjectTodo[] }>(`/api/projects/${projectId}/todos/suggest`, {
      method: "POST",
      body: json(count ? { count } : {}),
    }),

  updateTodo: (
    todoId: string,
    patch: { isCompleted?: boolean; category?: string; completedAt?: string },
  ) =>
    request<{ todo: ProjectTodo }>(`/api/todos/${todoId}`, {
      method: "PATCH",
      body: json(patch),
    }),

  /* ── 캘린더 ─────────────────────────────────────────────── */

  /** month 생략 시 이번 달 (KST 기준). 모든 프로젝트를 합쳐서 본다. */
  getCalendar: (month?: string) =>
    request<CalendarMonth>(`/api/calendar${month ? `?month=${month}` : ""}`),

  getCalendarDay: (date: string) => request<CalendarDayDetail>(`/api/calendar/${date}`),

  /* ── 월간 정산 / 공유 ───────────────────────────────────── */

  getMonthlyReport: (month?: string) =>
    request<{ report: MonthlyReport }>(
      `/api/reports/monthly${month ? `?month=${month}` : ""}`,
    ),

  /** 공유용 1080x1080 PNG 를 Blob 으로 받는다. */
  async getShareImage(month: string): Promise<Blob> {
    // 이미지 요청도 다른 API 와 같은 인증을 써야 한다.
    const session = getSession();
    const deviceId = session ? null : getDeviceId();
    const headers: Record<string, string> = session
      ? { Authorization: `Bearer ${session.accessToken}` }
      : deviceId
        ? { "x-device-id": deviceId }
        : {};
    const res = await fetch(`${BASE}/api/reports/monthly/${month}/image`, { headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiResponse<never> | null;
      throw new OdotApiError(
        body && !body.ok ? body.error.code : "INTERNAL",
        body && !body.ok ? body.error.message : "공유 이미지를 만들지 못했습니다.",
        undefined,
        res.status,
      );
    }
    return res.blob();
  },

  logShare: (month: string, result: ShareResult) =>
    request<{ log: ShareLog; shareImageUrl: string }>(
      `/api/reports/monthly/${month}/share`,
      { method: "POST", body: json({ result }) },
    ),

  /* ── 이벤트 ─────────────────────────────────────────────── */

  logEvent: (type: string, payload?: Record<string, unknown>) =>
    request<{ recorded: true }>("/api/events", {
      method: "POST",
      body: json({ type, payload }),
    }),
};

/** 공유 버튼이 실제로 어떻게 끝났는지 */
export type ShareOutcome = "requested" | "success" | "cancelled" | "saved" | "failed";

/**
 * 인스타그램 스토리로 보낸다.
 *
 * **웹에서 다른 앱으로 파일을 넘기는 방법은 navigator.share({files}) 하나뿐이다.**
 * 그래서 공유 시트를 띄운다 — 시트가 거추장스러워 보여도, 이미지가 인스타그램으로
 * 건너가는 통로가 그것뿐이다. 시트를 없애면 앱만 열리고 사진은 전달되지 않는다.
 * (instagram://story-camera 딥링크는 앱을 열 뿐 파일을 싣지 못한다.
 *  파일까지 실으려면 Facebook SDK 를 쓰는 네이티브 앱이어야 한다.)
 *
 * 파일 공유를 지원하지 않는 브라우저에서는 이미지를 저장하고 인스타그램을 연다.
 *
 * 돌려주는 값: "success" 공유함 · "cancelled" 사용자가 닫음 ·
 *              "saved" 저장 후 인스타그램 열림 · "failed" 실패
 */
export async function shareToInstagram(month: string): Promise<ShareOutcome> {
  let result: ShareOutcome = "requested";
  try {
    const blob = await odot.getShareImage(month);
    const file = new File([blob], `odot-${month}.png`, { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        result = "success";
      } catch (err) {
        // 사용자가 시트를 닫은 것은 실패가 아니다.
        result = (err as Error)?.name === "AbortError" ? "cancelled" : "failed";
      }
    } else {
      saveImage(blob, month);
      openInstagram();
      result = "saved";
    }
  } catch {
    result = "failed";
  }

  await odot.logShare(month, shareResultCode(result)).catch(() => undefined);
  return result;
}

/** 서버 기록은 정해진 값만 받는다. */
function shareResultCode(result: ShareOutcome): ShareResult {
  if (result === "success") return "success";
  if (result === "saved") return "no_app";
  if (result === "cancelled") return "requested";
  return "failed";
}

function saveImage(blob: Blob, month: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `odot-${month}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 인스타그램 앱을 연다. 앱이 없으면 잠시 뒤 웹으로 보낸다. */
function openInstagram(): void {
  const APP = "instagram://story-camera";
  const WEB = "https://www.instagram.com/";

  const fallback = setTimeout(() => {
    if (!document.hidden) window.location.href = WEB;
  }, 1500);

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) clearTimeout(fallback);
    },
    { once: true },
  );

  window.location.href = APP;
}
