import { z } from "zod";
import { ok, readJson, withRoute, preflight } from "@/lib/http";
import { db } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { createProject } from "@/lib/projects";
import { getDeck } from "@/lib/deck";
import { toProjectSummary, PROJECT_COLUMNS, type ProjectRow } from "@/lib/mappers";
import { TOPIC_IDS } from "@/lib/constants";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects — 내 프로젝트(세션) 목록, 최신 활동 순.
 * 클로드의 대화 목록처럼 쓰면 된다.
 */
export const GET = withRoute(async (req) => {
  const user = await requireUser(req);

  const { data, error } = await db()
    .from("projects")
    .select(`${PROJECT_COLUMNS}, card_reactions(reaction), todos(count)`)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as Array<
    ProjectRow & {
      card_reactions: Array<{ reaction: string }>;
      todos: Array<{ count: number }>;
    }
  >;

  return ok({
    projects: rows.map((row) => {
      const reactions = row.card_reactions ?? [];
      return toProjectSummary(row, {
        reactionCount: reactions.length,
        likeCount: reactions.filter((r) => r.reaction === "like").length,
        todoCount: row.todos?.[0]?.count ?? 0,
      });
    }),
  });
});

const BodySchema = z.object({
  topic: z.enum(TOPIC_IDS),
  /** topic === "etc" 일 때만 필요 */
  customTopic: z.string().trim().min(1).max(30).optional(),
});

/**
 * POST /api/projects — 새 세션을 연다.
 *
 * 관심사 하나를 고르면 프로젝트가 만들어지고, **첫 카드 덱이 함께 옵니다.**
 * 첫 덱은 시드 키워드로 즉시 채워지므로 AI 생성을 기다리지 않습니다.
 *
 * 이 프로젝트의 카드와 스와이프 이력은 이 안에만 쌓이고,
 * 다른 프로젝트를 열면 완전히 새 데이터에서 시작합니다.
 */
export const POST = withRoute(async (req) => {
  const user = await requireUser(req);
  const body = BodySchema.parse(await readJson(req));

  const { project, row } = await createProject(user, body);
  const deck = await getDeck(user, row);

  void logEvent(user.id, "project_created", { projectId: project.id, topic: body.topic });
  void logEvent(user.id, "card_impression", {
    projectId: project.id,
    count: deck.cards.length,
  });

  return ok({ project, deck });
});

export const OPTIONS = preflight;
