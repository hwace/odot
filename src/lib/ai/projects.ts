import { z } from "zod";
import { completeJson } from "@/lib/openai";
import { ApiError } from "@/lib/http";
import { policyFor, normalizeMinAge } from "@/lib/age";
import { screen } from "@/lib/moderation";
import { DURATION_PLAN, TOPIC_LABEL, TOPIC_OPTIONS } from "@/lib/constants";
import type { ProjectDuration, TopicId } from "@/types/api";

/** 캘린더 집계가 의미를 가지려면 할 일 카테고리가 초기 관심사 7종과 같아야 한다. */
const CATEGORY_LABELS = TOPIC_OPTIONS.map((t) => t.label);
const CATEGORY_SET = new Set(CATEGORY_LABELS);

const TodoSchema = z.object({
  content: z.string().min(1).max(200),
  category: z.string().min(1).max(30),
  recommendedAt: z.string().max(40).optional(),
  minAge: z.number().optional(),
});

const ProjectSchema = z.object({
  title: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  keywords: z.array(z.string().max(40)).max(10).optional(),
  todos: z.array(TodoSchema).min(1),
});

export interface GeneratedTodo {
  content: string;
  category: string;
  recommendedAt: string | null;
  orderIndex: number;
}

export interface GeneratedProject {
  title: string;
  description: string;
  keywords: string[];
  todos: GeneratedTodo[];
}

export interface ProjectGenerationInput {
  userId: string;
  age: number;
  /** 초기 설문의 대표 카테고리 */
  representativeCategory: TopicId;
  /** 관심을 표시한 키워드 (많이 볼수록 앞쪽) */
  likedKeywords: string[];
  duration: ProjectDuration;
  /** 프로젝트 전용 세션 키. 프로젝트끼리 맥락이 섞이지 않게 하는 격리 키. */
  sessionKey: string;
  /** 후보군에서 사용자가 고른 목표. 있으면 이걸 중심으로 만든다. */
  goal?: { title: string; why?: string };
}

/**
 * 관심 키워드 + 수행 기간으로 프로젝트 한 건과 할 일 목록을 만든다. (F-PEBLKV)
 *
 * 세션 키는 프로젝트당 하나만 발급되고 이 함수 밖으로 새 나가지 않는다.
 * 다른 프로젝트의 키워드나 이전 생성 결과는 프롬프트에 절대 넣지 않는다.
 */
export async function generateProject(
  input: ProjectGenerationInput,
): Promise<GeneratedProject> {
  const policy = policyFor(input.age);
  const plan = DURATION_PLAN[input.duration];

  const system = [
    "너는 학생과 취업준비생의 관심사를 실행 가능한 프로젝트로 바꿔주는 코치다.",
    "사용자가 관심을 보인 키워드들을 하나의 프로젝트 주제로 묶고, 정해진 기간 안에 순서대로 해낼 수 있는 할 일 목록을 만든다.",
    "",
    "[연령 정책 — 반드시 지킨다]",
    policy.promptGuidance,
    `다음 주제는 어떤 형태로도 언급하지 않는다: ${policy.blockedTerms.slice(0, 40).join(", ")}`,
    "",
    "[출력 형식]",
    'JSON 객체 하나만 출력한다. 모양: {"title":"","description":"","keywords":[],"todos":[{"content":"","category":"","recommendedAt":"","minAge":0}]}',
    "- title: 프로젝트 이름. 25자 이내.",
    "- description: 이 프로젝트로 무엇을 얻는지 2문장 이내.",
    "- keywords: 이 프로젝트에 실제로 반영한 관심 키워드.",
    "- todos: 배열 순서가 곧 수행 순서다. 앞에서 뒤로 갈수록 난이도가 올라가게 배치한다.",
    "- todos[].content: 한 번에 끝낼 수 있는 구체적인 행동. 50자 이내.",
    `- todos[].category: 반드시 다음 중 하나만 쓴다 — ${CATEGORY_LABELS.join(" | ")}. 애매하면 기타.`,
    `- todos[].recommendedAt: 권장 시점을 ${plan.unit} 단위로 적는다.`,
    "- todos[].minAge: 그 할 일을 안전하게 할 수 있는 최소 나이. 제한이 없으면 0.",
    "모든 문장은 한국어로 쓴다.",
  ].join("\n");

  const user = [
    `사용자 나이: ${input.age}세`,
    `대표 관심 카테고리: ${TOPIC_LABEL[input.representativeCategory]}`,
    `관심을 표시한 키워드: ${input.likedKeywords.slice(0, 20).join(", ")}`,
    `수행 기간: ${plan.label}`,
    // 사용자가 후보군에서 고른 목표가 있으면 그게 최우선이다.
    input.goal ? `사용자가 고른 목표: ${input.goal.title}` : "",
    input.goal?.why ? `그 목표를 고른 이유: ${input.goal.why}` : "",
    "",
    input.goal
      ? `'${input.goal.title}' 을 ${plan.label} 안에 해내기 위한 할 일 ${plan.todoCount}개를 만들어줘. 제목도 이 목표에 맞춰줘.`
      : `위 관심 키워드를 조합해서 ${plan.label} 동안 진행할 프로젝트 1개와 할 일 ${plan.todoCount}개를 만들어줘.`,
    `할 일은 ${plan.label} 안에 실제로 끝낼 수 있는 분량이어야 하고, 권장 시점을 ${plan.unit}로 고르게 나눠줘.`,
  ].join("\n");

  const payload = await completeJson<unknown>({
    system,
    user,
    sessionKey: input.sessionKey,
  });

  const parsed = ProjectSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError("AI_FAILED", "AI 응답 형식이 올바르지 않습니다. 다시 시도해주세요.");
  }

  const raw = parsed.data;

  // 제목/설명 검열
  const { passed: headerOk } = await screen(
    [`${raw.title} ${raw.description ?? ""}`],
    (t) => ({ text: t }),
    { userId: input.userId, age: input.age, source: "project" },
  );
  if (headerOk.length === 0) {
    throw new ApiError(
      "AGE_RESTRICTED",
      "연령에 맞는 프로젝트를 만들지 못했습니다. 다시 시도해주세요.",
    );
  }

  // 할 일 검열
  const { passed: todosOk } = await screen(
    raw.todos,
    (t) => ({ text: `${t.content} ${t.category}`, minAge: normalizeMinAge(t.minAge) }),
    { userId: input.userId, age: input.age, source: "todo" },
  );

  if (todosOk.length === 0) {
    throw new ApiError(
      "AGE_RESTRICTED",
      "연령에 맞는 할 일을 만들지 못했습니다. 다시 시도해주세요.",
    );
  }

  return {
    title: raw.title.trim(),
    description: (raw.description ?? "").trim(),
    keywords:
      raw.keywords?.map((k) => k.trim()).filter(Boolean) ??
      input.likedKeywords.slice(0, 5),
    todos: todosOk.map((t, i) => ({
      content: t.content.trim(),
      category: CATEGORY_SET.has(t.category.trim()) ? t.category.trim() : "기타",
      recommendedAt: t.recommendedAt?.trim() || null,
      orderIndex: i,
    })),
  };
}
