import { ok, withRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadOwnedProject } from "@/lib/projects";
import { getDeck } from "@/lib/deck";
import { DEFAULT_DECK_SIZE } from "@/lib/constants";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * GET /api/projects/:projectId/cards?limit=5
 *
 * 이 프로젝트의 카드 덱. 반응이 확정된 카드는 다시 나오지 않는다.
 * 덱이 비어 있으면 **트렌드 키워드로 즉시** 채우므로 AI 생성을 기다리지 않는다.
 *
 * 뒤쪽 카드는 POST .../cards/prefetch 로 미리 만들어 둔다.
 */
export const GET = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { projectId } = await ctx.params;
  const { project } = await loadOwnedProject(user, projectId);

  const raw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 20) : DEFAULT_DECK_SIZE;

  const deck = await getDeck(user, project, limit);

  void logEvent(user.id, "card_impression", {
    projectId,
    count: deck.cards.length,
    usedFallback: deck.usedFallback,
  });

  return ok(deck);
});
