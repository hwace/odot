import type { DurationOption, TopicId, TopicOption } from "@/types/api";

/** 초기 관심사 설문 카드 7종. 색은 PRD 표시 규칙 그대로. */
export const TOPIC_OPTIONS: TopicOption[] = [
  { id: "exercise", label: "운동", color: "red", requiresInput: false },
  { id: "study", label: "공부", color: "orange", requiresInput: false },
  { id: "reading", label: "독서", color: "green", requiresInput: false },
  { id: "music", label: "음악", color: "purple", requiresInput: false },
  { id: "culture", label: "교양", color: "yellow", requiresInput: false },
  { id: "career", label: "진로", color: "blue", requiresInput: false },
  { id: "etc", label: "기타", color: "gray", requiresInput: true },
];

export const TOPIC_IDS = TOPIC_OPTIONS.map((t) => t.id) as [TopicId, ...TopicId[]];

export const TOPIC_LABEL: Record<TopicId, string> = Object.fromEntries(
  TOPIC_OPTIONS.map((t) => [t.id, t.label]),
) as Record<TopicId, string>;

/** 프로젝트 수행 기간 (F-URTMLV 규칙) */
export const DURATION_OPTIONS: DurationOption[] = [
  { id: "1d", label: "1일" },
  { id: "1w", label: "1주" },
  { id: "1m", label: "1개월" },
  { id: "3m", label: "3개월" },
  { id: "6m", label: "6개월" },
];

/** 기간별로 AI가 만들 할 일 개수 범위와 '권장 시점' 단위 */
export const DURATION_PLAN: Record<
  string,
  { label: string; todoCount: number; unit: string }
> = {
  "1d": { label: "1일", todoCount: 4, unit: "시간대(오전/오후/저녁)" },
  "1w": { label: "1주", todoCount: 7, unit: "일차" },
  "1m": { label: "1개월", todoCount: 12, unit: "주차" },
  "3m": { label: "3개월", todoCount: 18, unit: "주차" },
  "6m": { label: "6개월", todoCount: 24, unit: "개월차" },
};

/** 반응 유형별 월간 정산 가중치 (F-NYHVHG) */
export const REACTION_SCORE = { like: 3, detail: 2, pass: -1 } as const;

/** 월간 정산 화면에 표시할 상위 키워드 수 */
export const REPORT_TOP_N = 5;

/** 한 번에 내려주는 카드 장수. 1~5번은 트렌드 키워드로 즉시 채운다. */
export const DEFAULT_DECK_SIZE = Number(process.env.CARD_DECK_SIZE ?? 5);

/**
 * 미리 만들어 둘 카드 장수.
 * 빠르게 넘기는 사용자가 생성 속도를 추월하지 않도록 넉넉히 잡는다.
 * (AI 한 번 호출에 5~10초 걸리는데, 700ms 간격으로 넘기면 5장은 3.5초에 동난다)
 */
export const LOOKAHEAD = Number(process.env.CARD_LOOKAHEAD ?? 8);

/**
 * 룩어헤드가 모자랄 때 한 번에 만들 최소 장수.
 *
 * 1장씩 만들면 카드를 넘길 때마다 AI 를 호출하게 되어, 빠르게 넘기는 사용자가
 * 생성 속도를 따라잡아 버린다. 한 번 호출할 때 넉넉히 받아 두면
 * 호출 수도 줄고 버퍼도 안정적으로 유지된다.
 */
export const REFILL_BATCH = Number(process.env.CARD_REFILL_BATCH ?? 8);

/** 프로젝트 추천을 열어주는 최소 '관심' 수 */
export const PROJECT_MIN_LIKES = Number(process.env.PROJECT_MIN_LIKES ?? 5);

/** 덱을 채울 때 한 번에 AI에게 요청할 최대 카드 수 */
export const MAX_AI_CARDS_PER_CALL = 12;
