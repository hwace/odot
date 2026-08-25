import { z } from "zod";
import { completeJson } from "@/lib/openai";
import { policyFor } from "@/lib/age";
import { screen } from "@/lib/moderation";

const SummarySchema = z.object({ easySummary: z.string().min(1).max(300) });

/**
 * 위로 스와이프했을 때 보여줄 '초등학생도 이해할 수 있는 1~2문장 요약'을 만든다.
 * (F-ZSDXRA 표시 규칙)
 *
 * 카드 생성 시점에 이미 만들어 두므로 보통은 호출되지 않고,
 * 시드/기본 키워드에서 온 카드처럼 요약이 비어 있을 때만 쓴다.
 */
export async function generateEasySummary(input: {
  userId: string;
  age: number;
  keyword: string;
  intro: string;
}): Promise<string | null> {
  const policy = policyFor(input.age);

  const system = [
    "너는 어려운 개념을 초등학생도 이해할 수 있게 풀어주는 도우미다.",
    policy.promptGuidance,
    '출력은 JSON 객체 하나: {"easySummary":""}',
    "easySummary 는 1~2문장, 전부 쉬운 한국어 낱말로만 쓴다. 영어 약자와 전문 용어를 쓰지 않는다.",
  ].join("\n");

  const user = [
    `활동 이름: ${input.keyword}`,
    input.intro ? `간단한 소개: ${input.intro}` : "",
    "이 활동이 무엇이고 왜 해볼 만한지 쉬운 말로 1~2문장으로 설명해줘.",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = await completeJson<unknown>({ system, user });
  const parsed = SummarySchema.safeParse(payload);
  if (!parsed.success) return null;

  const summary = parsed.data.easySummary.trim();
  const { passed } = await screen(
    [summary],
    (t) => ({ text: t }),
    { userId: input.userId, age: input.age, source: "card_summary" },
  );

  return passed[0] ?? null;
}
