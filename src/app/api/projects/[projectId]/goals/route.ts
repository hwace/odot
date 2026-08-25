import { z } from "zod";
import { ok, readJson, withRoute, preflight, ApiError } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { loadOwnedProject, computeEligibility } from "@/lib/projects";
import { generateGoalCandidates } from "@/lib/ai/goals";
import { logEvent } from "@/lib/events";
import type { TopicId } from "@/types/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

const BodySchema = z.object({
  answers: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(120),
        answer: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(12),
  /** 받고 싶은 후보 개수 (2~5, 기본 3) */
  count: z.number().int().min(2).max(5).optional(),
});

/**
 * POST /api/projects/:projectId/goals — 할 일 후보군 만들기
 *
 * 이 프로젝트에서 오른쪽으로 넘긴 관심 키워드에 **설문 답변**을 더해
 * 서로 다른 목표 후보를 돌려준다. 카드만으로는 "무엇에 끌리는지"밖에 모르는데,
 * 설문이 쓸 수 있는 시간·원하는 결과물·예산 같은 조건을 붙여 준다.
 *
 * 사용자가 후보 하나를 고르면 POST .../todos 로 실제 할 일 목록을 만든다.
 */
export const POST = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { projectId } = await ctx.params;
  const body = BodySchema.parse(await readJson(req));

  const { project } = await loadOwnedProject(user, projectId);
  const eligibility = await computeEligibility(project);

  if (!eligibility.eligible) {
    throw new ApiError("NOT_ENOUGH_SIGNAL", eligibility.message, {
      likeCount: eligibility.likeCount,
      requiredLikeCount: eligibility.requiredLikeCount,
    });
  }

  const goals = await generateGoalCandidates({
    userId: user.id,
    age: user.age,
    topic: (project.topic ?? "etc") as TopicId,
    customTopic: project.custom_topic,
    likedKeywords: eligibility.likedKeywords,
    answers: body.answers,
    count: body.count,
  });

  if (goals.length === 0) {
    throw new ApiError("AI_FAILED", "목표 후보를 만들지 못했습니다. 다시 시도해주세요.");
  }

  void logEvent(user.id, "goals_generated", { projectId, count: goals.length });
  return ok({ projectId, goals, likedKeywords: eligibility.likedKeywords });
});

export const OPTIONS = preflight;
