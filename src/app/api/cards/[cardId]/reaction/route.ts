import { z } from "zod";
import { ok, readJson, withRoute, preflight, ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { countRemaining } from "@/lib/deck";
import { logEvent } from "@/lib/events";
import { loadSummary } from "@/lib/summaries";
import type { ReactionResult } from "@/types/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cardId: string }> };

const BodySchema = z.object({
  reaction: z.enum(["like", "pass", "detail"]),
});

/**
 * POST /api/cards/:cardId/reaction
 * 스와이프를 끝내고 손가락을 뗄 때 한 번만 호출한다. (F-ZSDXRA)
 *
 *   like   = 오른쪽 (관심 있음 — 나중에 할 일 재료가 된다)
 *   pass   = 왼쪽   (관심 없음)
 *   detail = 위쪽   (쉬운 요약 보기) — 응답의 summary 에 요약이 함께 온다
 *
 * 반응은 카드가 속한 프로젝트에만 기록된다.
 * 같은 카드에 두 번 호출하면 ALREADY_REACTED 로 거절된다.
 */
export const POST = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { cardId } = await ctx.params;
  const { reaction } = BodySchema.parse(await readJson(req));

  const { data: cardData, error: cardErr } = await db()
    .from("keyword_cards")
    .select("id, user_id, project_id, keyword, category, min_age")
    .eq("id", cardId)
    .maybeSingle();
  if (cardErr) throw cardErr;
  if (!cardData) throw new ApiError("NOT_FOUND", "카드를 찾을 수 없습니다.");

  const card = cardData as {
    id: string;
    user_id: string;
    project_id: string;
    keyword: string;
    category: string;
    min_age: number;
  };

  if (card.user_id !== user.id) {
    throw new ApiError("FORBIDDEN", "다른 사용자의 카드입니다.");
  }
  if (card.min_age > user.age) {
    throw new ApiError("AGE_RESTRICTED", "연령에 맞지 않아 반응할 수 없는 카드입니다.");
  }

  const reactedAt = new Date().toISOString();
  const { error } = await db().from("card_reactions").insert({
    user_id: user.id,
    project_id: card.project_id,
    card_id: card.id,
    keyword: card.keyword,
    category: card.category,
    reaction,
    reacted_at: reactedAt,
  });

  if (error) {
    // unique (user_id, card_id) 위반 = 이미 확정된 카드
    if (error.code === "23505") {
      throw new ApiError("ALREADY_REACTED", "이미 넘긴 카드입니다.");
    }
    throw error;
  }

  // 세션 활동 시각을 올려서 프로젝트 목록이 최근 순으로 정렬되게 한다.
  await db()
    .from("projects")
    .update({ updated_at: reactedAt })
    .eq("id", card.project_id);

  const summary =
    reaction === "detail" ? await loadSummary(user.id, user.age, card.id) : null;

  void logEvent(user.id, "card_reaction", {
    projectId: card.project_id,
    cardId: card.id,
    keyword: card.keyword,
    reaction,
  });

  const result: ReactionResult = {
    projectId: card.project_id,
    cardId: card.id,
    reaction,
    reactedAt,
    summary,
    remaining: await countRemaining(card.project_id, user.age),
  };
  return ok(result);
});

export const OPTIONS = preflight;
