import { ok, withRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadOwnedProject, computeEligibility } from "@/lib/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * GET /api/projects/:projectId/eligibility
 * 이 프로젝트에서 할 일 만들기 버튼을 켤지 끌지, 안내 문구는 뭘 띄울지,
 * 고를 수 있는 기간은 무엇인지를 한 번에 돌려준다. (F-URTMLV 표시 규칙)
 */
export const GET = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { projectId } = await ctx.params;
  const { project } = await loadOwnedProject(user, projectId);
  return ok(await computeEligibility(project));
});
