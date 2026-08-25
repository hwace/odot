import { randomUUID } from "node:crypto";
import { db } from "@/lib/supabase";
import { ApiError } from "@/lib/http";
import { generateProject } from "@/lib/ai/projects";
import { screenUserInput } from "@/lib/moderation";
import {
  toProject,
  PROJECT_COLUMNS,
  TODO_COLUMNS,
  type ProjectRow,
  type TodoRow,
} from "@/lib/mappers";
import { DURATION_OPTIONS, PROJECT_MIN_LIKES } from "@/lib/constants";
import type { UserRow } from "@/lib/auth";
import type { Project, ProjectDuration, ProjectEligibility, TopicId } from "@/types/api";

/**
 * 프로젝트 = 세션.
 *
 * 프로젝트를 만들면 그 안에서 카드 스와이프가 시작되고, 카드와 반응은 전부
 * 그 프로젝트에만 쌓인다. 다른 프로젝트를 열면 완전히 새 데이터에서 시작한다.
 * (클로드 대화창을 새로 여는 것과 같은 모델)
 *
 * 흐름: 프로젝트 생성(관심사 선택) → 카드 스와이프 → 기간 선택 → 할 일 생성
 */

/** 새 세션을 연다. 관심사 하나를 골라야 시작할 수 있다. (F-YNUHQI) */
export async function createProject(
  user: UserRow,
  input: { topic: TopicId; customTopic?: string },
): Promise<{ project: Project; sessionKey: string; row: ProjectRow }> {
  if (input.topic === "etc" && !input.customTopic) {
    throw new ApiError("BAD_REQUEST", "기타를 선택하면 관심사를 직접 입력해야 합니다.");
  }

  // 직접 입력한 관심사도 연령 검열을 거친다.
  if (input.customTopic) {
    const verdict = await screenUserInput(input.customTopic, {
      userId: user.id,
      age: user.age,
      source: "custom_topic",
    });
    if (!verdict.allowed) {
      throw new ApiError(
        "AGE_RESTRICTED",
        "입력한 관심사는 사용할 수 없습니다. 다른 관심사를 적어주세요.",
      );
    }
  }

  const { data, error } = await db()
    .from("projects")
    .insert({
      user_id: user.id,
      topic: input.topic,
      custom_topic: input.topic === "etc" ? input.customTopic : null,
      status: "collecting",
      keywords: [],
    })
    .select(PROJECT_COLUMNS)
    .single();
  if (error) throw error;

  const row = data as ProjectRow;

  // 프로젝트 전용 세션 키 — 다른 프로젝트와 생성 맥락을 섞지 않기 위한 격리 키
  const sessionKey = `proj_${row.id}_${randomUUID().slice(0, 8)}`;
  await db().from("project_sessions").insert({ project_id: row.id, session_key: sessionKey });

  return { project: toProject(row, sessionKey, []), sessionKey, row };
}

/** 이 프로젝트 안에서 할 일을 만들 수 있는 상태인지 (F-URTMLV) */
export async function computeEligibility(
  project: ProjectRow,
): Promise<ProjectEligibility> {
  const { data, error } = await db()
    .from("card_reactions")
    .select("keyword, category, reacted_at")
    .eq("project_id", project.id)
    .eq("reaction", "like")
    .order("reacted_at", { ascending: false });
  if (error) throw error;

  const likes = (data ?? []) as Array<{ keyword: string; category: string | null }>;

  // 같은 키워드가 두 번 잡히지 않도록 최근 것만 남긴다.
  const seen = new Set<string>();
  const likedCards: Array<{ keyword: string; category: TopicId }> = [];
  for (const like of likes) {
    if (seen.has(like.keyword)) continue;
    seen.add(like.keyword);
    likedCards.push({
      keyword: like.keyword,
      category: (like.category ?? project.topic ?? "etc") as TopicId,
    });
  }

  const likedKeywords = likedCards.map((c) => c.keyword);
  const likeCount = likedKeywords.length;
  const eligible = likeCount >= PROJECT_MIN_LIKES;

  return {
    projectId: project.id,
    eligible,
    likeCount,
    requiredLikeCount: PROJECT_MIN_LIKES,
    likedKeywords,
    likedCards,
    message: eligible
      ? "관심 키워드를 조합해 할 일을 만들 수 있어요."
      : `카드를 ${PROJECT_MIN_LIKES - likeCount}개만 더 관심으로 넘기면 할 일을 만들 수 있어요.`,
    durations: DURATION_OPTIONS,
  };
}

/**
 * 이 프로젝트에서 모은 관심 키워드를 조합해 할 일 목록을 만든다. (F-PEBLKV)
 * 실패하면 status='failed' 로 남겨서 재생성 버튼을 붙일 수 있게 한다.
 */
export async function generateTodos(
  user: UserRow,
  project: ProjectRow,
  sessionKey: string,
  duration: ProjectDuration,
  /** 후보군에서 고른 목표. 있으면 그 목표를 중심으로 만든다. */
  goal?: { title: string; why?: string },
): Promise<Project> {
  const eligibility = await computeEligibility(project);
  if (!eligibility.eligible) {
    throw new ApiError("NOT_ENOUGH_SIGNAL", eligibility.message, {
      likeCount: eligibility.likeCount,
      requiredLikeCount: eligibility.requiredLikeCount,
    });
  }

  await db().from("project_requests").insert({
    user_id: user.id,
    project_id: project.id,
    duration,
    representative_category: project.topic,
  });

  // 재생성이면 이전 할 일을 비운다.
  await db().from("todos").delete().eq("project_id", project.id);
  await db()
    .from("projects")
    .update({
      duration,
      status: "generating",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", project.id);

  try {
    const generated = await generateProject({
      userId: user.id,
      age: user.age,
      representativeCategory: (project.topic ?? "etc") as TopicId,
      likedKeywords: eligibility.likedKeywords,
      duration,
      sessionKey,
      goal,
    });

    const { data: updated, error: uErr } = await db()
      .from("projects")
      .update({
        title: generated.title,
        description: generated.description,
        keywords: generated.keywords,
        status: "ready",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .select(PROJECT_COLUMNS)
      .single();
    if (uErr) throw uErr;

    const { data: todos, error: tErr } = await db()
      .from("todos")
      .insert(
        generated.todos.map((t) => ({
          user_id: user.id,
          project_id: project.id,
          content: t.content,
          category: t.category,
          order_index: t.orderIndex,
          recommended_at: t.recommendedAt,
        })),
      )
      .select(TODO_COLUMNS);
    if (tErr) throw tErr;

    await db()
      .from("project_sessions")
      .update({ last_active_at: new Date().toISOString() })
      .eq("project_id", project.id);

    return toProject(updated as ProjectRow, sessionKey, (todos ?? []) as TodoRow[]);
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "AI 생성에 실패했습니다. 다시 시도해주세요.";
    await db()
      .from("projects")
      .update({ status: "failed", error_message: message, updated_at: new Date().toISOString() })
      .eq("id", project.id);
    throw err instanceof ApiError ? err : new ApiError("AI_FAILED", message);
  }
}

/** 소유권까지 확인해서 프로젝트를 읽는다. */
export async function loadOwnedProject(
  user: UserRow,
  projectId: string,
): Promise<{ project: ProjectRow; sessionKey: string }> {
  const { data, error } = await db()
    .from("projects")
    .select(`${PROJECT_COLUMNS}, user_id`)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError("NOT_FOUND", "프로젝트를 찾을 수 없습니다.");

  const row = data as ProjectRow & { user_id: string };
  if (row.user_id !== user.id) {
    throw new ApiError("FORBIDDEN", "다른 사용자의 프로젝트입니다.");
  }

  const { data: session } = await db()
    .from("project_sessions")
    .select("session_key")
    .eq("project_id", projectId)
    .maybeSingle();

  return {
    project: row,
    sessionKey: (session as { session_key: string } | null)?.session_key ?? "",
  };
}

export async function loadTodos(projectId: string): Promise<TodoRow[]> {
  const { data, error } = await db()
    .from("todos")
    .select(TODO_COLUMNS)
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TodoRow[];
}
