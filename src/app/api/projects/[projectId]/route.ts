import { z } from "zod";
import { ok, readJson, withRoute, preflight, ApiError } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadOwnedProject, loadTodos, computeEligibility } from "@/lib/projects";
import { db } from "@/lib/supabase";
import { screenUserInput } from "@/lib/moderation";
import { toProject, PROJECT_COLUMNS, type ProjectRow } from "@/lib/mappers";

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

const PatchSchema = z.object({
  /** 프로젝트 이름. 같은 카테고리로 여러 개를 만들면 이름으로 구분한다. */
  title: z.string().trim().min(1).max(40),
});

/**
 * PATCH /api/projects/:projectId — 프로젝트 이름 바꾸기
 *
 * 같은 관심사로 프로젝트를 여러 개 만들면 목록에서 구분이 안 된다.
 * 사용자가 직접 쓴 이름이므로 연령 검열을 거친다.
 */
export const PATCH = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { projectId } = await ctx.params;
  const { title } = PatchSchema.parse(await readJson(req));

  const { project, sessionKey } = await loadOwnedProject(user, projectId);

  const verdict = await screenUserInput(title, {
    userId: user.id,
    age: user.age,
    source: "project_title",
  });
  if (!verdict.allowed) {
    throw new ApiError("AGE_RESTRICTED", "그 이름은 쓸 수 없습니다. 다르게 지어주세요.");
  }

  const { data, error } = await db()
    .from("projects")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", project.id)
    .select(PROJECT_COLUMNS)
    .single();
  if (error) throw error;

  const todos = await loadTodos(project.id);
  return ok({ project: toProject(data as ProjectRow, sessionKey, todos) });
});

export const OPTIONS = preflight;
