import { ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import { generateEasySummary } from "@/lib/ai/summary";
import type { CardSummary } from "@/types/api";

/**
 * 카드의 쉬운 요약을 가져온다. (F-ZSDXRA)
 *
 * 저장돼 있으면 그대로 쓰고, 없으면(시드/기본 키워드에서 온 카드) 그 자리에서
 * 만들어 저장한다. 라우트 파일은 핸들러만 export 할 수 있어서 이 헬퍼는
 * 여기 lib 에 둔다 — 요약 조회 라우트와 반응 라우트가 함께 쓴다.
 */
export async function loadSummary(
  userId: string,
  age: number,
  cardId: string,
): Promise<CardSummary> {
  const { data, error } = await db()
    .from("keyword_cards")
    .select("id, user_id, keyword, intro, easy_summary, min_age")
    .eq("id", cardId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("NOT_FOUND", "카드를 찾을 수 없습니다.");

  const card = data as {
    id: string;
    user_id: string;
    keyword: string;
    intro: string;
    easy_summary: string | null;
    min_age: number;
  };

  if (card.user_id !== userId) {
    throw new ApiError("FORBIDDEN", "다른 사용자의 카드입니다.");
  }
  if (card.min_age > age) {
    throw new ApiError("AGE_RESTRICTED", "연령에 맞지 않아 보여줄 수 없는 카드입니다.");
  }

  if (card.easy_summary) {
    return { cardId: card.id, keyword: card.keyword, easySummary: card.easy_summary };
  }

  const generated = await generateEasySummary({
    userId,
    age,
    keyword: card.keyword,
    intro: card.intro,
  });

  const easySummary =
    generated ??
    `${card.keyword}은(는) ${card.intro || "지금 해볼 만한 활동"}이에요. 오늘 조금만 해봐도 괜찮아요.`;

  await db().from("keyword_cards").update({ easy_summary: easySummary }).eq("id", card.id);

  return { cardId: card.id, keyword: card.keyword, easySummary };
}
