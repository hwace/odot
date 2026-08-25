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
  CalendarDayDetail,
  CalendarMonth,
  CardDeck,
  CardSummary,
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

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const merged = new Headers(headers);
  merged.set("Content-Type", "application/json");

  if (auth) {
    const deviceId = getDeviceId();
    if (deviceId) merged.set("x-device-id", deviceId);
  }

  const res = await fetch(`${BASE}${path}`, { ...rest, headers: merged });
  const body = (await res.json()) as ApiResponse<T>;

  if (!body.ok) {
    throw new OdotApiError(body.error.code, body.error.message, body.error.details, res.status);
  }
  return body.data;
}

const json = (body: unknown) => JSON.stringify(body);

export const odot = {
  /* ── 사용자 ─────────────────────────────────────────────── */

  /** 첫 실행. 나이를 받아 익명 사용자를 만들고 deviceId 를 저장한다. */
  async createUser(input: { age: number }): Promise<{ user: User; isNew: boolean }> {
    const data = await request<{ user: User; isNew: boolean }>("/api/users/anonymous", {
      method: "POST",
      auth: false,
      body: json({ deviceId: getDeviceId() ?? undefined, age: input.age }),
    });
    setDeviceId(data.user.deviceId);
    return data;
  },

  getMe: () => request<MeResponse>("/api/me"),

  /** 나이 수정. 연령 정책이 바로 다시 적용된다. */
  updateAge: (age: number) =>
    request<MeResponse>("/api/me", { method: "PATCH", body: json({ age }) }),

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

  /* ── 할 일 ──────────────────────────────────────────────── */

  /**
   * 이 프로젝트에서 모은 관심 키워드를 조합해 할 일을 만든다.
   * 다시 부르면 재생성된다 (실패 시 "다시 만들기"도 같은 호출).
   * 응답까지 몇 초 걸린다.
   */
  createTodos: (projectId: string, duration: ProjectDuration) =>
    request<{ project: Project }>(`/api/projects/${projectId}/todos`, {
      method: "POST",
      body: json({ duration }),
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
    const deviceId = getDeviceId();
    const res = await fetch(`${BASE}/api/reports/monthly/${month}/image`, {
      headers: deviceId ? { "x-device-id": deviceId } : {},
    });
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

/**
 * 인스타그램 공유 한 번에 처리하기.
 * 기기 공유 시트를 띄우고 결과까지 서버에 기록한다.
 */
export async function shareToInstagram(month: string): Promise<ShareResult> {
  let result: ShareResult = "requested";
  try {
    const blob = await odot.getShareImage(month);
    const file = new File([blob], `odot-${month}.png`, { type: "image/png" });

    if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `odot ${month} 관심사 정산` });
      result = "success";
    } else {
      // 공유 시트를 못 쓰는 환경 → 인스타 앱이 없다고 보고 안내 화면으로 넘긴다.
      result = "no_app";
    }
  } catch {
    result = "failed";
  }

  await odot.logShare(month, result).catch(() => undefined);
  return result;
}
