import { ok, withRoute } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadOwnedProject, loadTodos, computeEligibility } from "@/lib/projects";
import { toProject } from "@/lib/mappers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * GET /api/projects/:projectId — 세션 하나를 연다.
 *
 * 프로젝트 정보 + 할 일 목록 + 이 프로젝트 안에서의 진행 상황이 함께 온다.
 * 카드 덱은 GET /api/projects/:projectId/cards 로 따로 받는다.
 */
export const GET = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { projectId } = await ctx.params;

  const { project, sessionKey } = await loadOwnedProject(user, projectId);
  const [todos, eligibility] = await Promise.all([
    loadTodos(project.id),
    computeEligibility(project),
  ]);

  return ok({ project: toProject(project, sessionKey, todos), eligibility });
});
