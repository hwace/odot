import type {
  KeywordCard,
  Project,
  ProjectDuration,
  ProjectStatus,
  ProjectSummary,
  ProjectTodo,
  TopicId,
} from "@/types/api";

/* DB row(snake_case) → API 응답(camelCase) 변환을 한곳에 모아둔다. */

export interface CardRow {
  id: string;
  keyword: string;
  intro: string;
  reason: string;
  easy_summary: string | null;
  category: string;
  source: string;
  min_age: number;
  created_at: string;
}

export function toCard(row: CardRow): KeywordCard {
  return {
    id: row.id,
    keyword: row.keyword,
    intro: row.intro,
    reason: row.reason,
    category: row.category as TopicId,
    source: row.source as KeywordCard["source"],
    createdAt: row.created_at,
  };
}

export interface TodoRow {
  id: string;
  project_id: string | null;
  content: string;
  category: string;
  order_index: number;
  recommended_at: string | null;
  is_completed: boolean;
  completed_at: string | null;
}

export const TODO_COLUMNS =
  "id, project_id, content, category, order_index, recommended_at, is_completed, completed_at";

export function toTodo(row: TodoRow): ProjectTodo {
  return {
    id: row.id,
    projectId: row.project_id,
    content: row.content,
    category: row.category,
    orderIndex: row.order_index,
    recommendedAt: row.recommended_at,
    isCompleted: row.is_completed,
    completedAt: row.completed_at,
  };
}

export interface ProjectRow {
  id: string;
  title: string | null;
  description: string | null;
  topic: TopicId | null;
  custom_topic: string | null;
  keywords: string[];
  duration: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export const PROJECT_COLUMNS =
  "id, title, description, topic, custom_topic, keywords, duration, status, error_message, created_at, updated_at";

export function toProject(
  row: ProjectRow,
  sessionKey: string,
  todos: TodoRow[],
): Project {
  return {
    id: row.id,
    // 할 일 생성 전에는 제목이 비어 있다. 빈 문자열 대신 null 로 통일한다.
    title: row.title?.trim() ? row.title : null,
    description: row.description,
    topic: (row.topic ?? "etc") as TopicId,
    customTopic: row.custom_topic,
    keywords: row.keywords ?? [],
    duration: (row.duration as ProjectDuration | null) ?? null,
    status: row.status as ProjectStatus,
    errorMessage: row.error_message,
    sessionKey,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    todos: todos.map(toTodo),
  };
}

export function toProjectSummary(
  row: ProjectRow,
  counts: { reactionCount: number; likeCount: number; todoCount: number },
): ProjectSummary {
  return {
    id: row.id,
    title: row.title?.trim() ? row.title : null,
    topic: (row.topic ?? "etc") as TopicId,
    customTopic: row.custom_topic,
    duration: (row.duration as ProjectDuration | null) ?? null,
    status: row.status as ProjectStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...counts,
  };
}
