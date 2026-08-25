import { z } from "zod";
import { completeJson } from "@/lib/openai";
import { policyFor, normalizeMinAge } from "@/lib/age";
import { screen } from "@/lib/moderation";
import { TOPIC_IDS, TOPIC_LABEL, MAX_AI_CARDS_PER_CALL } from "@/lib/constants";
import type { TopicId } from "@/types/api";

export interface GeneratedCard {
  keyword: string;
  intro: string;
  reason: string;
  easySummary: string;
  category: TopicId;
  minAge: number;
}

const CardSchema = z.object({
  keyword: z.string().min(1).max(12),
  intro: z.string().min(1).max(60),
  reason: z.string().min(1).max(80),
  easySummary: z.string().min(1).max(200),
  category: z.enum(TOPIC_IDS),
  minAge: z.number().optional(),
});

const PayloadSchema = z.object({ cards: z.array(CardSchema) });

export interface CardGenerationInput {
  userId: string;
  age: number;
  /** 이 프로젝트를 시작할 때 고른 관심사 */
  topic: TopicId;
  customTopic: string | null;
  /** 오른쪽으로 넘긴(관심 있는) 키워드들 */
  likedKeywords: string[];
  /** 왼쪽으로 넘긴(관심 없는) 키워드들 */
  passedKeywords: string[];
  /** 이 프로젝트에서 이미 나온 키워드 — 다시 내보내면 안 된다 */
  excludeKeywords: string[];
  /** 트렌드 소스에서 가져온 참고 키워드 */
  trendKeywords: string[];
  count: number;
}

/**
 * 카드에 들어갈 **주제 키워드**를 만든다. (F-OVNIBD)
 *
 * 카드는 할 일이 아니라 키워드다 — "수학", "클라이밍", "심리학" 처럼.
 * 사용자가 오른쪽으로 넘긴 키워드들을 나중에 조합해서 할 일을 만들기 때문에,
 * 여기서는 조합하기 좋은 재료를 뽑는 게 목적이다.
 *
 * 생성 결과는 반드시 연령 검열을 통과한 것만 돌려준다.
 */
export async function generateCards(
  input: CardGenerationInput,
): Promise<GeneratedCard[]> {
  const policy = policyFor(input.age);
  const count = Math.min(Math.max(input.count, 1), MAX_AI_CARDS_PER_CALL);

  const system = [
    "너는 한국의 중고등학생·대학생·취업준비생에게 '관심 가질 만한 주제 키워드'를 추천하는 도우미다.",
    "",
    "[가장 중요한 규칙]",
    "카드에는 **할 일이 아니라 키워드**가 들어간다.",
    "좋은 예: 수학, 클라이밍, 심리학, 웹소설, 포트폴리오, 캘리그라피, 데이터분석",
    "나쁜 예: 오답노트 다시 쓰기, 하루 10쪽 읽기, 10분 스트레칭 하기 (— 이건 할 일이지 키워드가 아니다)",
    "keyword 는 명사여야 하고, 동사나 '~하기' 로 끝나면 안 된다. 되도록 2~6글자.",
    "",
    "[연령 정책 — 반드시 지킨다]",
    policy.promptGuidance,
    `다음 주제는 어떤 형태로도 언급하지 않는다: ${policy.blockedTerms.slice(0, 40).join(", ")}`,
    "",
    "[출력 형식]",
    'JSON 객체 하나만 출력한다. 모양: {"cards":[{"keyword":"","intro":"","reason":"","easySummary":"","category":"","minAge":0}]}',
    "- keyword: 주제 키워드. 명사, 2~6글자 권장, 최대 12글자.",
    "- intro: 이 키워드가 무엇인지 한 줄 설명. 25자 이내.",
    "- reason: 이 사용자에게 왜 추천하는지. 30자 이내.",
    "- easySummary: 초등학생도 이해할 수 있는 쉬운 말로 1~2문장. 어려운 낱말과 영어 약자를 쓰지 않는다.",
    `- category: ${TOPIC_IDS.join(" | ")} 중 하나.`,
    "- minAge: 이 주제를 안전하게 다룰 수 있는 최소 나이. 제한이 없으면 0.",
    "모든 문장은 한국어로 쓴다.",
  ].join("\n");

  const interest = input.customTopic
    ? `${TOPIC_LABEL[input.topic]} (직접 입력: ${input.customTopic})`
    : TOPIC_LABEL[input.topic];

  const user = [
    `사용자 나이: ${input.age}세`,
    `이 프로젝트의 관심 주제: ${interest}`,
    input.likedKeywords.length
      ? `관심 있다고 표시한 키워드: ${input.likedKeywords.slice(0, 20).join(", ")}`
      : "관심 표시 이력: 아직 없음",
    input.passedKeywords.length
      ? `관심 없다고 넘긴 키워드: ${input.passedKeywords.slice(0, 20).join(", ")}`
      : "",
    input.trendKeywords.length
      ? `요즘 많이 검색되는 키워드(참고용): ${input.trendKeywords.slice(0, 15).join(", ")}`
      : "",
    input.excludeKeywords.length
      ? `이미 보여준 키워드라 절대 다시 쓰면 안 되는 것: ${input.excludeKeywords.slice(0, 80).join(", ")}`
      : "",
    "",
    `위 정보를 바탕으로 서로 겹치지 않는 주제 키워드 ${count}개를 만들어줘.`,
    "관심 있다고 표시한 키워드와 결이 비슷한 것을 절반쯤, 아직 안 본 새로운 갈래를 나머지로 섞어줘.",
    "관심 없다고 넘긴 키워드와 비슷한 것은 넣지 마.",
    "다시 강조: keyword 는 '~하기' 같은 할 일이 아니라 명사 키워드여야 한다.",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = await completeJson<unknown>({ system, user });
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return [];

  const seen = new Set(input.excludeKeywords.map((k) => k.trim()));
  const candidates: GeneratedCard[] = [];
  for (const c of parsed.data.cards) {
    const keyword = c.keyword.trim();
    if (!keyword || seen.has(keyword)) continue;
    // 모델이 가끔 할 일 문구를 넣는다. 명사형이 아니면 버린다.
    if (looksLikeTodo(keyword)) continue;
    seen.add(keyword);
    candidates.push({
      keyword,
      intro: c.intro.trim(),
      reason: c.reason.trim(),
      easySummary: c.easySummary.trim(),
      category: c.category,
      minAge: normalizeMinAge(c.minAge),
    });
  }

  const { passed } = await screen(
    candidates,
    (c) => ({
      text: `${c.keyword} ${c.intro} ${c.reason} ${c.easySummary}`,
      minAge: c.minAge,
    }),
    { userId: input.userId, age: input.age, source: "card" },
  );

  return passed;
}

/** "10분 스트레칭 하기" 같은 행동 문구를 걸러낸다. 키워드는 명사여야 한다. */
function looksLikeTodo(keyword: string): boolean {
  if (/\s/.test(keyword) && keyword.length > 8) return true;
  return /(하기|보기|읽기|쓰기|만들기|정리하기|해보기|되기|가기|듣기|찾기)$/.test(keyword);
}
