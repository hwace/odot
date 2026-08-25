import { z } from "zod";
import { ok, readJson, withRoute, preflight } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadOwnedProject, generateTodos } from "@/lib/projects";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

const BodySchema = z.object({
  duration: z.enum(["1d", "1w", "1m", "3m", "6m"]),
  /** 후보군에서 고른 목표. 주면 그 목표에 맞춰 할 일을 만든다. */
  goal: z
    .object({
      title: z.string().trim().min(1).max(60),
      why: z.string().trim().max(120).optional(),
    })
    .optional(),
});

/**
 * POST /api/projects/:projectId/todos — 관심 키워드를 조합해 할 일 목록을 만든다.
 *
 * 이 프로젝트에서 오른쪽으로 넘긴 키워드들만 재료로 쓴다 (다른 프로젝트와 섞이지 않음).
 * 다시 호출하면 기존 할 일을 지우고 같은 세션 안에서 새로 만든다 —
 * 생성 실패 시의 "다시 만들기" 버튼도 이 엔드포인트를 그대로 쓰면 된다.
 *
 * 동기 호출이라 응답까지 몇 초 걸린다. 진행 상태를 띄워두면 된다.
 */
export const POST = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { projectId } = await ctx.params;
  const { duration, goal } = BodySchema.parse(await readJson(req));

  const { project, sessionKey } = await loadOwnedProject(user, projectId);

  try {
    const result = await generateTodos(user, project, sessionKey, duration, goal);
    void logEvent(user.id, "project_generated", {
      projectId,
      duration,
      todoCount: result.todos.length,
    });
    return ok({ project: result });
  } catch (err) {
    void logEvent(user.id, "project_failed", {
      projectId,
      duration,
      message: err instanceof Error ? err.message : "unknown",
    });
    throw err;
  }
});

export const OPTIONS = preflight;
