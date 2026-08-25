import { z } from "zod";
import { ok, readJson, withRoute, preflight, ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { loadOwnedProject } from "@/lib/projects";
import { screenUserInput } from "@/lib/moderation";
import { toTodo, TODO_COLUMNS, type TodoRow } from "@/lib/mappers";
import { TOPIC_OPTIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const CATEGORIES = TOPIC_OPTIONS.map((t) => t.label) as [string, ...string[]];

const BodySchema = z.object({
  projectId: z.string().uuid(),
  content: z.string().trim().min(1).max(80),
  /** 캘린더 집계에 쓰는 카테고리. 없으면 기타 */
  category: z.enum(CATEGORIES).optional(),
  recommendedAt: z.string().trim().max(40).optional(),
});

/**
 * POST /api/todos — 할 일 직접 추가
 *
 * 프로젝트 상세에서 사용자가 손으로 적어 넣는 경로다.
 * 사용자가 직접 쓴 글이므로 연령 검열을 거친다.
 */
export const POST = withRoute(async (req) => {
  const user = await requireUser(req);
  const body = BodySchema.parse(await readJson(req));

  // 소유권 확인 — 남의 프로젝트에는 넣을 수 없다.
  const { project } = await loadOwnedProject(user, body.projectId);

  const verdict = await screenUserInput(body.content, {
    userId: user.id,
    age: user.age,
    source: "todo",
  });
  if (!verdict.allowed) {
    throw new ApiError("AGE_RESTRICTED", "입력한 내용은 사용할 수 없습니다. 다르게 적어주세요.");
  }

  // 목록 맨 뒤에 붙인다.
  const { count } = await db()
    .from("todos")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);

  const { data, error } = await db()
    .from("todos")
    .insert({
      user_id: user.id,
      project_id: project.id,
      content: body.content,
      category: body.category ?? "기타",
      order_index: count ?? 0,
      recommended_at: body.recommendedAt ?? null,
    })
    .select(TODO_COLUMNS)
    .single();
  if (error) throw error;

  return ok({ todo: toTodo(data as TodoRow) });
});

export const OPTIONS = preflight;
