import { z } from "zod";
import { ok, readJson, withRoute, preflight } from "@/lib/http";
import { db } from "@/lib/supabase";
import { requireUser, toUser, USER_COLUMNS, type UserRow } from "@/lib/auth";
import { MAX_AGE, MIN_AGE } from "@/lib/age";
import type { MeResponse } from "@/types/api";

export const dynamic = "force-dynamic";

/** GET /api/me — 현재 사용자 + 모든 프로젝트를 합친 누적 통계 */
export const GET = withRoute(async (req) => ok(await loadMe(await requireUser(req))));

const PatchSchema = z.object({
  age: z.number().int().min(MIN_AGE).max(MAX_AGE),
});

/**
 * PATCH /api/me — 나이 수정.
 * 나이가 바뀌면 연령 정책도 즉시 바뀌므로, 아직 반응하지 않은 카드 중
 * 새 나이로는 볼 수 없는 카드를 함께 정리한다.
 */
export const PATCH = withRoute(async (req) => {
  const user = await requireUser(req);
  const { age } = PatchSchema.parse(await readJson(req));

  const { data, error } = await db()
    .from("users")
    .update({ age })
    .eq("id", user.id)
    .select(USER_COLUMNS)
    .single();
  if (error) throw error;

  await db().from("keyword_cards").delete().eq("user_id", user.id).gt("min_age", age);

  return ok(await loadMe(data as UserRow));
});

export const OPTIONS = preflight;

async function loadMe(user: UserRow): Promise<MeResponse> {
  const [reactions, projects, todos] = await Promise.all([
    db().from("card_reactions").select("reaction").eq("user_id", user.id),
    db().from("projects").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    db()
      .from("todos")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_completed", true),
  ]);

  const list = (reactions.data ?? []) as Array<{ reaction: string }>;

  return {
    user: toUser(user),
    stats: {
      totalReactions: list.length,
      likeCount: list.filter((r) => r.reaction === "like").length,
      detailCount: list.filter((r) => r.reaction === "detail").length,
      projectCount: projects.count ?? 0,
      completedTodoCount: todos.count ?? 0,
    },
  };
}
