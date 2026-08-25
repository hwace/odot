/**
 * odot 백엔드 API 공용 타입.
 *
 * 프론트엔드에서 그대로 import 해서 쓰면 된다:
 *   import type { KeywordCard, ApiResponse } from "@/types/api";
 *
 * 모든 API 응답은 예외 없이 ApiResponse<T> 형태다.
 */

/* ─── 공통 응답 ─────────────────────────────────────────────────────── */

export type ApiSuccess<T> = { ok: true; data: T };

export type ApiFailure = {
  ok: false;
  error: {
    /** 프론트에서 분기용으로 쓰는 안정적인 코드. 아래 ApiErrorCode 참고 */
    code: ApiErrorCode;
    /** 사용자에게 그대로 보여줄 수 있는 한국어 메시지 */
    message: string;
    /** 유효성 오류일 때 필드별 상세 */
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type ApiErrorCode =
  | "BAD_REQUEST"        // 400 · 입력값 형식 오류
  | "UNAUTHENTICATED"    // 401 · x-device-id 헤더 없음
  | "USER_NOT_FOUND"     // 401 · 계정 정보를 찾을 수 없음
  | "INVALID_CREDENTIALS"// 401 · 이메일 또는 비밀번호가 틀림
  | "EMAIL_TAKEN"        // 409 · 이미 가입된 이메일
  | "FORBIDDEN"          // 403 · 남의 리소스 접근
  | "NOT_FOUND"          // 404
  | "ALREADY_REACTED"    // 409 · 이미 반응이 확정된 카드
  | "NOT_ENOUGH_SIGNAL"  // 409 · 프로젝트 추천에 필요한 관심 데이터 부족
  | "AGE_RESTRICTED"     // 422 · 연령 정책상 제공할 수 없는 내용
  | "AI_FAILED"          // 502 · AI 생성 실패 (즉시 재시도 가능)
  | "INTERNAL";          // 500

/* ─── 사용자 ────────────────────────────────────────────────────────── */

/** 나이 구간. 콘텐츠 검열 강도를 결정한다. */
export type AgeGroup = "child" | "middle" | "high" | "adult";

export interface User {
  id: string;
  /** 이메일 계정으로 가입한 경우. 익명 과도기 경로면 null */
  email: string | null;
  age: number;
  ageGroup: AgeGroup;
  isMinor: boolean;
  createdAt: string;
  lastActiveAt: string;
  /** @deprecated 익명 과도기 경로에서만 채워진다. 로그인이 붙으면 사라진다. */
  deviceId: string | null;
}

/** 로그인 세션. accessToken 을 Authorization: Bearer 로 실어 보낸다. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  /** 액세스 토큰 만료 시각 (ISO) */
  expiresAt: string;
}

export interface AuthResult {
  user: User;
  session: Session;
  isNew: boolean;
}

export interface MeResponse {
  user: User;
  stats: {
    /** 모든 프로젝트를 합친 총 스와이프 수 */
    totalReactions: number;
    /** 오른쪽 스와이프(관심) 수 */
    likeCount: number;
    /** 위로 스와이프(요약 확인) 수 */
    detailCount: number;
    projectCount: number;
    completedTodoCount: number;
  };
}

/* ─── 관심사 주제 (F-YNUHQI) ───────────────────────────────────────── */

export type TopicId =
  | "exercise"
  | "study"
  | "reading"
  | "music"
  | "culture"
  | "career"
  | "etc";

export interface TopicOption {
  id: TopicId;
  /** 화면에 표시할 한국어 라벨 */
  label: string;
  /** PRD에 지정된 카드 색 (프론트가 참고용으로 쓰거나 무시해도 됨) */
  color: "red" | "orange" | "green" | "purple" | "yellow" | "blue" | "gray";
  /** true면 customTopic 직접 입력이 필요한 카드 */
  requiresInput: boolean;
}

/* ─── 키워드 카드 (F-OVNIBD, F-ZSDXRA) ──────────────────────────────── */

/** 카드 출처. `default` = 큐레이션 시드 풀, `ai` = 생성 */
export type CardSource = "default" | "ai";

export interface KeywordCard {
  id: string;
  /** 짧은 주제 키워드. 행동 문구가 아니다 — "수학", "클라이밍" 처럼. */
  keyword: string;
  /** 이 키워드가 무엇인지 한 줄 설명 */
  intro: string;
  /** 왜 이 카드를 추천했는지 */
  reason: string;
  category: TopicId;
  source: CardSource;
  createdAt: string;
}

export interface CardDeck {
  projectId: string;
  cards: KeywordCard[];
  /** 아직 반응하지 않은 카드 총 장수 */
  remaining: number;
}

/** 위로 스와이프했을 때 보여주는, 초등학생도 이해할 수 있는 1~2문장 요약 */
export interface CardSummary {
  cardId: string;
  keyword: string;
  easySummary: string;
}

export type ReactionType =
  /** 오른쪽 스와이프 · 관심 있음 */
  | "like"
  /** 왼쪽 스와이프 · 관심 없음 */
  | "pass"
  /** 위로 스와이프 · 쉬운 요약 보기 */
  | "detail";

export interface ReactionResult {
  projectId: string;
  cardId: string;
  reaction: ReactionType;
  reactedAt: string;
  /** reaction === "detail" 일 때만 채워진다 */
  summary: CardSummary | null;
  /** 이 반응 이후 남은 덱의 장수 */
  remaining: number;
}

/* ─── 프로젝트 = 세션 (F-URTMLV, F-PEBLKV) ─────────────────────────── */

export type ProjectDuration = "1d" | "1w" | "1m" | "3m" | "6m";

export interface DurationOption {
  id: ProjectDuration;
  label: string;
}

export type ProjectStatus =
  /** 카드를 넘기며 관심 키워드를 모으는 중 */
  | "collecting"
  /** AI가 할 일 목록을 만드는 중 */
  | "generating"
  /** 할 일 목록까지 완성 */
  | "ready"
  /** 생성 실패 — 재시도 가능 */
  | "failed";

export interface ProjectEligibility {
  projectId: string;
  /** false면 할 일 만들기 버튼을 비활성화한다 */
  eligible: boolean;
  likeCount: number;
  requiredLikeCount: number;
  /** 이 프로젝트에서 관심을 표시한 키워드 (최근 순) */
  likedKeywords: string[];
  /** 아직 부족할 때 화면에 띄울 안내 문구 */
  message: string;
  durations: DurationOption[];
}

export interface ProjectTodo {
  id: string;
  projectId: string | null;
  content: string;
  category: string;
  /** 권장 순서 (0부터) */
  orderIndex: number;
  /** 권장 시점. 예: "1일차", "2주차" */
  recommendedAt: string | null;
  isCompleted: boolean;
  completedAt: string | null;
}

/**
 * 프로젝트는 하나의 독립된 세션이다.
 * 카드 덱과 스와이프 이력이 전부 이 프로젝트 안에만 남고,
 * 다른 프로젝트를 열면 완전히 새 데이터로 시작한다.
 */
export interface Project {
  id: string;
  /** 할 일 생성 전에는 null */
  title: string | null;
  description: string | null;
  /** 이 프로젝트를 시작할 때 고른 관심사 */
  topic: TopicId;
  customTopic: string | null;
  /** AI가 할 일을 만들 때 실제로 조합한 관심 키워드 */
  keywords: string[];
  /** 할 일 생성 전에는 null */
  duration: ProjectDuration | null;
  status: ProjectStatus;
  errorMessage: string | null;
  /** 이 프로젝트 전용 세션 키. 다른 프로젝트와 맥락이 섞이지 않는다 */
  sessionKey: string;
  createdAt: string;
  updatedAt: string;
  todos: ProjectTodo[];
}

/** 목록 조회용 — 대화 목록처럼 쓴다 */
export interface ProjectSummary {
  id: string;
  title: string | null;
  topic: TopicId;
  customTopic: string | null;
  duration: ProjectDuration | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  /** 이 프로젝트에서 넘긴 카드 수 */
  reactionCount: number;
  /** 그중 관심으로 넘긴 수 */
  likeCount: number;
  todoCount: number;
}

/* ─── 완료 캘린더 (F-IYXFDA) ────────────────────────────────────────── */

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  /** 그 날 가장 많이 완료한 카테고리. 완료한 할 일이 없으면 그 날짜는 응답에 아예 없다 */
  topCategory: string;
  doneCount: number;
  /** 카테고리별 완료 수 */
  breakdown: Array<{ category: string; count: number }>;
}

export interface CalendarMonth {
  /** YYYY-MM */
  month: string;
  days: CalendarDay[];
}

export interface CalendarDayDetail {
  date: string;
  doneCount: number;
  breakdown: Array<{ category: string; count: number }>;
  todos: ProjectTodo[];
}

/* ─── 월간 정산 & 공유 (F-NYHVHG, F-ZVJSOW) ─────────────────────────── */

export interface ReportKeyword {
  keyword: string;
  category: string;
  /** 관심 점수 (like=3, detail=2, pass=-1 가중합) */
  score: number;
  rank: number;
  /** 이전 달 대비 점수 변화량. 이전 달에 없던 키워드면 null */
  delta: number | null;
  /** 이번 달에 새로 등장한 키워드인지 */
  isNew: boolean;
}

export interface MonthlyReport {
  /** YYYY-MM */
  month: string;
  /** 상위 5개 */
  topKeywords: ReportKeyword[];
  totalReactions: number;
  likeCount: number;
  /** true면 이번 달 반응이 없어 빈 상태 안내를 띄워야 한다 */
  isEmpty: boolean;
  generatedAt: string;
  /** 인스타 공유용 1080x1080 PNG 주소 */
  shareImageUrl: string;
}

export type ShareResult = "requested" | "success" | "failed" | "no_app";

export interface ShareLog {
  id: string;
  month: string;
  channel: "instagram";
  result: ShareResult;
  sharedAt: string;
}

/* ─── 이벤트 로그 ───────────────────────────────────────────────────── */

export type EventType =
  | "signup"
  | "login"
  | "project_created"
  | "card_impression"
  | "card_prefetch"
  | "card_reaction"
  | "card_summary_view"
  | "project_request"
  | "project_generated"
  | "project_failed"
  | "calendar_view"
  | "report_view"
  | "share_attempt";
