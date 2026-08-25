import { ok, withRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadSummary } from "@/lib/summaries";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cardId: string }> };

/**
 * GET /api/cards/:cardId/summary
 * 위로 스와이프했을 때 보여줄 쉬운 요약. (F-ZSDXRA)
 *
 * 반응 확정과 요약 조회를 따로 하고 싶을 때 쓴다.
 * 한 번에 처리하려면 POST /api/cards/:cardId/reaction 에 reaction:"detail" 을 보내면 된다.
 */
export const GET = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { cardId } = await ctx.params;

  const summary = await loadSummary(user.id, user.age, cardId);
  void logEvent(user.id, "card_summary_view", { cardId });
  return ok({ summary });
});
