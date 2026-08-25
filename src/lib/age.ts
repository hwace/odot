import type { AgeGroup } from "@/types/api";

/**
 * 연령 정책.
 *
 * PRD 리스크 항목("미성년자도 사용하는 서비스이므로 연령에 부적절하거나 검증되지
 * 않은 활동 추천을 방지할 기준이 필요하다")에 대응하는 기준값들을 한곳에 모았다.
 * 실제 차단은 lib/moderation.ts 에서 이 정책을 읽어 수행한다.
 */

export const MIN_AGE = 5;
export const MAX_AGE = 120;

export function ageGroupOf(age: number): AgeGroup {
  if (age < 13) return "child";
  if (age < 16) return "middle";
  if (age < 19) return "high";
  return "adult";
}

export function isMinor(age: number): boolean {
  return age < 19;
}

export interface AgePolicy {
  group: AgeGroup;
  label: string;
  /** AI 프롬프트에 그대로 주입하는 연령 지침 */
  promptGuidance: string;
  /** 이 연령대에 노출 금지인 주제. 부분 문자열로 검사한다. */
  blockedTerms: string[];
  /** 이 연령대에서 허용하지 않는 OpenAI moderation 카테고리 */
  blockedModerationCategories: string[];
  /** moderation 카테고리 점수 임계값. 낮을수록 엄격 */
  moderationThreshold: number;
}

/** 모든 연령대에서 무조건 막는 주제 */
const UNIVERSAL_BLOCK = [
  "자해", "자살", "극단적 선택", "폭탄", "총기", "마약", "필로폰", "대마",
  "성매매", "몸캠", "불법촬영", "해킹 대행", "사기", "보이스피싱",
  "다단계", "리딩방", "원금 보장",
];

/** 미성년자(19세 미만) 공통 차단 */
const MINOR_BLOCK = [
  "술", "음주", "소주", "맥주", "위스키", "와인", "주점", "클럽", "유흥",
  "담배", "흡연", "전자담배", "베이핑",
  "도박", "카지노", "바카라", "토토", "베팅", "슬롯",
  "성인", "19금", "청불", "타투", "문신", "성형",
  "코인", "선물거래", "레버리지", "공매도", "대출", "신용카드 발급",
  "다이어트 약", "단식원", "제모 시술",
];

/** 13세 미만 추가 차단 — 보호자 동반 없이 하기 어려운 활동 */
const CHILD_BLOCK = [
  "혼자 여행", "야간 아르바이트", "아르바이트", "알바", "이력서", "면접",
  "헬스장 등록", "단백질 보충제", "오토바이", "운전", "심야",
  "익명 채팅", "랜덤 채팅", "오픈채팅", "만남",
];

/** 16세 미만 추가 차단 */
const MIDDLE_BLOCK = ["야간 아르바이트", "심야", "랜덤 채팅", "익명 만남", "오토바이", "운전"];

const POLICIES: Record<AgeGroup, AgePolicy> = {
  child: {
    group: "child",
    label: "13세 미만",
    promptGuidance: [
      "사용자는 13세 미만 어린이다.",
      "학교 안이나 집에서 보호자의 도움 없이도 안전하게 할 수 있는 활동만 추천한다.",
      "돈을 쓰는 활동, 혼자 이동해야 하는 활동, 아르바이트나 취업 관련 활동은 추천하지 않는다.",
      "모든 문장을 초등학생이 바로 이해할 수 있는 쉬운 말로 쓴다.",
    ].join(" "),
    blockedTerms: [...UNIVERSAL_BLOCK, ...MINOR_BLOCK, ...CHILD_BLOCK],
    blockedModerationCategories: [
      "sexual", "sexual/minors", "violence", "violence/graphic",
      "self-harm", "self-harm/intent", "self-harm/instructions",
      "hate", "hate/threatening", "harassment", "harassment/threatening", "illicit",
    ],
    moderationThreshold: 0.15,
  },
  middle: {
    group: "middle",
    label: "중학생(13~15세)",
    promptGuidance: [
      "사용자는 중학생이다.",
      "학교생활, 공부 습관, 취미, 운동, 진로 탐색처럼 미성년자가 안전하게 시작할 수 있는 활동만 추천한다.",
      "음주, 흡연, 도박, 투자, 대출, 성인 콘텐츠, 신체 시술과 관련된 활동은 절대 추천하지 않는다.",
      "야간 이동이나 보호자 동의가 필요한 활동은 피한다.",
    ].join(" "),
    blockedTerms: [...UNIVERSAL_BLOCK, ...MINOR_BLOCK, ...MIDDLE_BLOCK],
    blockedModerationCategories: [
      "sexual", "sexual/minors", "violence", "violence/graphic",
      "self-harm", "self-harm/intent", "self-harm/instructions",
      "hate", "hate/threatening", "harassment/threatening", "illicit",
    ],
    moderationThreshold: 0.2,
  },
  high: {
    group: "high",
    label: "고등학생(16~18세)",
    promptGuidance: [
      "사용자는 고등학생이다.",
      "입시, 진로 탐색, 자기관리, 대외활동, 취미처럼 미성년자가 할 수 있는 활동을 추천한다.",
      "음주, 흡연, 도박, 코인·주식 투자, 대출, 성인 콘텐츠, 문신 같은 미성년자 금지 활동은 추천하지 않는다.",
      "아르바이트를 다룰 때는 청소년 근로 기준을 지키는 범위에서만 언급한다.",
    ].join(" "),
    blockedTerms: [...UNIVERSAL_BLOCK, ...MINOR_BLOCK],
    blockedModerationCategories: [
      "sexual", "sexual/minors", "violence/graphic",
      "self-harm", "self-harm/intent", "self-harm/instructions",
      "hate/threatening", "harassment/threatening", "illicit",
    ],
    moderationThreshold: 0.3,
  },
  adult: {
    group: "adult",
    label: "성인(19세 이상)",
    promptGuidance: [
      "사용자는 성인 대학생 또는 취업 준비생이다.",
      "학업, 취업 준비, 커리어, 자기계발, 건강, 취미 등 실행 가능한 활동을 추천한다.",
      "불법 행위, 자해, 도박, 고위험 투기성 활동은 추천하지 않는다.",
    ].join(" "),
    blockedTerms: [...UNIVERSAL_BLOCK],
    blockedModerationCategories: [
      "sexual/minors", "violence/graphic",
      "self-harm", "self-harm/intent", "self-harm/instructions",
      "hate/threatening", "harassment/threatening", "illicit",
    ],
    moderationThreshold: 0.5,
  },
};

export function policyFor(age: number): AgePolicy {
  return POLICIES[ageGroupOf(age)];
}

export function policyForGroup(group: AgeGroup): AgePolicy {
  return POLICIES[group];
}

/**
 * 카드/할 일에 붙는 최소 권장 연령. AI가 직접 정하게 두면 들쭉날쭉해서,
 * 정책상 허용된 값(0 / 13 / 16 / 19)으로만 정규화한다.
 */
export function normalizeMinAge(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 13) return 13;
  if (n <= 16) return 16;
  return 19;
}
