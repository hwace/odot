import { z } from "zod";
import { ok, readJson, withRoute, preflight, ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { toTodo, type TodoRow } from "@/lib/mappers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ todoId: string }> };

const TODO_COLUMNS =
  "id, project_id, content, category, order_index, recommended_at, is_completed, completed_at";

const BodySchema = z
  .object({
    isCompleted: z.boolean().optional(),
    /** 완료 기록을 캘린더에 집계할 카테고리. 비워두면 기존 값을 유지한다. */
    category: z.string().trim().min(1).max(30).optional(),
    /** 완료 시각을 직접 지정할 때만. 없으면 지금 시각. */
    completedAt: z.string().datetime().optional(),
  })
  .refine((v) => v.isCompleted !== undefined || v.category !== undefined, {
    message: "isCompleted 또는 category 중 하나는 있어야 합니다.",
  });

/**
 * PATCH /api/todos/:todoId
 * 할 일 완료 처리 / 카테고리 변경. (F-IYXFDA 선행 조건)
 *
 * isCompleted: true 로 보내면 completedAt 이 채워지고 캘린더 집계에 잡힌다.
 * false 로 되돌리면 completedAt 이 지워진다.
 */
export const PATCH = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { todoId } = await ctx.params;
  const body = BodySchema.parse(await readJson(req));

  const { data: existing, error: findErr } = await db()
    .from("todos")
    .select(`${TODO_COLUMNS}, user_id`)
    .eq("id", todoId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!existing) throw new ApiError("NOT_FOUND", "할 일을 찾을 수 없습니다.");
  if ((existing as { user_id: string }).user_id !== user.id) {
    throw new ApiError("FORBIDDEN", "다른 사용자의 할 일입니다.");
  }

  const patch: Record<string, unknown> = {};
  if (body.category !== undefined) patch.category = body.category;
  if (body.isCompleted !== undefined) {
    patch.is_completed = body.isCompleted;
    patch.completed_at = body.isCompleted
      ? body.completedAt ?? new Date().toISOString()
      : null;
  }

  const { data, error } = await db()
    .from("todos")
    .update(patch)
    .eq("id", todoId)
    .select(TODO_COLUMNS)
    .single();
  if (error) throw error;

  return ok({ todo: toTodo(data as TodoRow) });
});

export const OPTIONS = preflight;
