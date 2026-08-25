import { z } from "zod";
import { ok, readJson, withRoute, preflight } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadOwnedProject } from "@/lib/projects";
import { prefetchDeck } from "@/lib/deck";
import { LOOKAHEAD } from "@/lib/constants";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

const BodySchema = z.object({
  /** 미리 채워둘 장수. 기본 4 = "2번 카드를 볼 때 6번 카드를 만든다" */
  lookahead: z.number().int().min(1).max(12).optional(),
});

/**
 * POST /api/projects/:projectId/cards/prefetch
 *
 * 앞으로 볼 카드를 미리 만들어 둔다. 카드를 한 장 넘길 때마다 부르면 된다.
 * 남은 장수가 충분하면 아무것도 하지 않고 바로 돌아오므로 자주 불러도 괜찮고,
 * 같은 프로젝트에 대한 동시 호출은 서버에서 하나로 합쳐진다.
 *
 * 응답을 기다릴 필요는 없다 — 결과는 다음 GET .../cards 에 반영된다.
 */
export const POST = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { projectId } = await ctx.params;
  const { project } = await loadOwnedProject(user, projectId);

  const { lookahead } = BodySchema.parse(await readJson(req));
  const result = await prefetchDeck(user, project, lookahead ?? LOOKAHEAD);

  if (result.generated > 0) {
    void logEvent(user.id, "card_prefetch", { projectId, generated: result.generated });
  }
  return ok(result);
});

export const OPTIONS = preflight;
