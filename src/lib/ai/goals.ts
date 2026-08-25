import { z } from "zod";
import { completeJson } from "@/lib/openai";
import { policyFor } from "@/lib/age";
import { screen } from "@/lib/moderation";
import { TOPIC_LABEL } from "@/lib/constants";
import type { TopicId } from "@/types/api";

/**
 * 관심 카드 + 설문 답변을 조합해 **할 일 후보군**을 만든다. (F-URTMLV → F-PEBLKV 사이)
 *
 * 카드만으로는 "무엇에 끌리는지"만 알 수 있다. 설문은 거기에
 * 쓸 수 있는 시간·원하는 결과물·혼자/함께·예산·중단 이유를 붙여 준다.
 * 둘을 합쳐야 실제로 끝낼 수 있는 목표가 나온다.
 *
 * 후보를 여러 개 주는 이유는 사용자가 고르게 하기 위해서다 —
 * 하나만 던지면 마음에 안 들 때 되돌릴 방법이 없다.
 */

export interface GoalCandidate {
  title: string;
  /** 이 목표가 얼마짜리인지 — 프론트에서 뱃지로 쓴다 */
  horizon: "단기" | "중기" | "장기";
  /** 왜 이 사람에게 맞는지 한 줄 */
  why: string;
  /** 첫 행동 미리보기 (전체 할 일은 고른 뒤 생성한다) */
  firstSteps: string[];
  /** 어울리는 수행 기간 */
  suggestedDuration: "1d" | "1w" | "1m" | "3m" | "6m";
}

const GoalSchema = z.object({
  title: z.string().min(1).max(40),
  horizon: z.enum(["단기", "중기", "장기"]),
  why: z.string().min(1).max(80),
  firstSteps: z.array(z.string().min(1).max(60)).min(2).max(4),
  suggestedDuration: z.enum(["1d", "1w", "1m", "3m", "6m"]),
});

const PayloadSchema = z.object({ goals: z.array(GoalSchema) });

export interface GoalGenerationInput {
  userId: string;
  age: number;
  topic: TopicId;
  customTopic: string | null;
  /** 오른쪽으로 넘긴 키워드 (최근 순) */
  likedKeywords: string[];
  /** 설문 질문/답변 쌍 */
  answers: Array<{ question: string; answer: string }>;
  count?: number;
}

export async function generateGoalCandidates(
  input: GoalGenerationInput,
): Promise<GoalCandidate[]> {
  const policy = policyFor(input.age);
  const count = Math.min(Math.max(input.count ?? 3, 2), 5);

  const system = [
    "너는 학생과 취업준비생이 '무엇을 할지' 정하도록 돕는 코치다.",
    "사용자가 관심을 보인 키워드와 설문 답변을 함께 보고, 실제로 끝낼 수 있는 목표 후보를 만든다.",
    "",
    "[반드시 지킨다]",
    "- 설문 답변을 무시하지 않는다. 쓸 수 있는 시간·원하는 결과물·혼자/함께·예산·중단 이유가 목표에 반영돼야 한다.",
    "- 시간이 적다고 답했으면 작은 목표를, 결과물을 원한다고 했으면 남는 것이 있는 목표를 준다.",
    "- 후보끼리 서로 다른 방향이어야 한다. 같은 목표를 말만 바꿔 내놓지 않는다.",
    "",
    "[연령 정책 — 반드시 지킨다]",
    policy.promptGuidance,
    `다음 주제는 어떤 형태로도 언급하지 않는다: ${policy.blockedTerms.slice(0, 40).join(", ")}`,
    "",
    "[출력 형식]",
    'JSON 객체 하나만 출력한다. 모양: {"goals":[{"title":"","horizon":"","why":"","firstSteps":[],"suggestedDuration":""}]}',
    "- title: 목표 이름. 20자 이내.",
    "- horizon: 단기 | 중기 | 장기 중 하나.",
    "- why: 이 사람에게 왜 맞는지. 설문 답변을 근거로 든다. 40자 이내.",
    "- firstSteps: 시작하는 행동 2~3개. 각 30자 이내.",
    "- suggestedDuration: 1d | 1w | 1m | 3m | 6m 중 하나.",
    "모든 문장은 한국어로 쓴다.",
  ].join("\n");

  const interest = input.customTopic ?? TOPIC_LABEL[input.topic];

  const user = [
    `사용자 나이: ${input.age}세`,
    `프로젝트 주제: ${interest}`,
    `관심을 표시한 키워드: ${input.likedKeywords.slice(0, 20).join(", ")}`,
    "",
    "설문 답변:",
    ...input.answers.map((a, i) => `${i + 1}. ${a.question} → ${a.answer}`),
    "",
    `위를 종합해서 서로 다른 목표 후보 ${count}개를 만들어줘.`,
  ].join("\n");

  const payload = await completeJson<unknown>({ system, user });
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return [];

  const candidates: GoalCandidate[] = parsed.data.goals.map((g) => ({
    title: g.title.trim(),
    horizon: g.horizon,
    why: g.why.trim(),
    firstSteps: g.firstSteps.map((x) => x.trim()).filter(Boolean),
    suggestedDuration: g.suggestedDuration,
  }));

  const { passed } = await screen(
    candidates,
    (g) => ({ text: `${g.title} ${g.why} ${g.firstSteps.join(" ")}` }),
    { userId: input.userId, age: input.age, source: "goal" },
  );

  return passed;
}
