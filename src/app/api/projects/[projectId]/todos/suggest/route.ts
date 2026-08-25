import { z } from "zod";
import { ok, readJson, withRoute, preflight, ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { loadOwnedProject, loadTodos, computeEligibility } from "@/lib/projects";
import { generateMoreTodos } from "@/lib/ai/projects";
import { toTodo, TODO_COLUMNS, type TodoRow } from "@/lib/mappers";
import { logEvent } from "@/lib/events";
import type { ProjectDuration } from "@/types/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

const BodySchema = z.object({
  /** 몇 개를 더 받을지 (1~6, 기본 3) */
  count: z.number().int().min(1).max(6).optional(),
});

/**
 * POST /api/projects/:projectId/todos/suggest — 할 일 이어서 추천받기
 *
 * 전체 재생성(POST .../todos)과 다르다. **지금 목록은 그대로 두고** 뒤에 덧붙인다.
 * 이미 있는 할 일을 AI 에게 함께 보내 중복을 피하고 다음 단계로 이어지게 한다.
 */
export const POST = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { projectId } = await ctx.params;
  const { count = 3 } = BodySchema.parse(await readJson(req));

  const { project, sessionKey } = await loadOwnedProject(user, projectId);
  const existing = await loadTodos(project.id);

  if (existing.length === 0) {
    throw new ApiError("NOT_ENOUGH_SIGNAL", "먼저 할 일 목록을 만들어주세요.");
  }

  const eligibility = await computeEligibility(project);

  const generated = await generateMoreTodos({
    userId: user.id,
    age: user.age,
    projectTitle: project.title ?? "",
    likedKeywords: eligibility.likedKeywords,
    duration: (project.duration as ProjectDuration) ?? "1w",
    sessionKey,
    existing: existing.map((t) => ({ content: t.content, recommendedAt: t.recommended_at })),
    count,
  });

  if (generated.length === 0) {
    throw new ApiError("AI_FAILED", "이어질 할 일을 만들지 못했습니다. 다시 시도해주세요.");
  }

  const { data, error } = await db()
    .from("todos")
    .insert(
      generated.map((t) => ({
        user_id: user.id,
        project_id: project.id,
        content: t.content,
        category: t.category,
        order_index: t.orderIndex,
        recommended_at: t.recommendedAt,
      })),
    )
    .select(TODO_COLUMNS);
  if (error) throw error;

  void logEvent(user.id, "todos_suggested", { projectId, count: generated.length });
  return ok({ todos: ((data ?? []) as TodoRow[]).map(toTodo) });
});

export const OPTIONS = preflight;
