import { db } from "@/lib/supabase";
import { generateCards } from "@/lib/ai/cards";
import { fetchDefaults, fetchTrending } from "@/lib/trends";
import { screenLocal } from "@/lib/moderation";
import { toCard, type CardRow } from "@/lib/mappers";
import {
  DEFAULT_DECK_SIZE,
  LOOKAHEAD,
  MAX_AI_CARDS_PER_CALL,
  REFILL_BATCH,
} from "@/lib/constants";
import type { UserRow } from "@/lib/auth";
import type { ProjectRow } from "@/lib/mappers";
import type { CardDeck, TopicId } from "@/types/api";

/**
 * 카드 덱 (F-OVNIBD) — 프로젝트 단위로 관리한다.
 *
 * 기다리지 않게 만드는 게 핵심이다:
 *
 *   · 첫 덱(1~5번)은 **트렌드 키워드로 즉시** 만든다. AI 호출이 없어서 바로 나온다.
 *   · 2번 카드를 볼 때쯤 6번 카드를 미리 만들어 둔다 (prefetchDeck).
 *     그래서 사용자가 카드를 넘길 때 생성 대기가 생기지 않는다.
 *
 * 카드와 반응은 전부 project_id 에 묶이므로, 다른 프로젝트를 열면
 * 완전히 새 덱에서 시작한다.
 */

/** 같은 프로젝트에 대해 생성이 겹치지 않게 막는다 (한 프로세스 안에서) */
const generating = new Map<string, Promise<number>>();

/** 프로젝트의 현재 덱을 돌려준다. 비어 있으면 트렌드로 즉시 채운다. */
export async function getDeck(
  user: UserRow,
  project: ProjectRow,
  size = DEFAULT_DECK_SIZE,
): Promise<CardDeck> {
  let cards = await fetchUnreacted(project.id, user.age, size);
  let usedFallback = false;

  if (cards.length === 0) {
    // 첫 진입 — AI를 기다리지 않도록 트렌드 키워드로 즉시 채운다.
    const seeded = await seedFromTrend(user, project, size);
    usedFallback = seeded.usedFallback;
    if (seeded.count > 0) cards = await fetchUnreacted(project.id, user.age, size);
  }

  return {
    projectId: project.id,
    cards: cards.map(toCard),
    remaining: await countRemaining(project.id, user.age),
    usedFallback,
  };
}

/**
 * 앞으로 볼 카드를 미리 만들어 둔다.
 *
 * 클라이언트가 카드를 넘길 때마다 부르면 된다 — 남은 장수가 충분하면
 * 아무것도 하지 않고 즉시 돌아오므로 자주 불러도 괜찮다.
 * 같은 프로젝트에 대한 동시 호출은 하나로 합쳐진다.
 */
export async function prefetchDeck(
  user: UserRow,
  project: ProjectRow,
  lookahead = LOOKAHEAD,
): Promise<{ remaining: number; generated: number }> {
  const remaining = await countRemaining(project.id, user.age);
  if (remaining >= lookahead) return { remaining, generated: 0 };

  // 모자란 만큼만 만들면 카드 한 장 넘길 때마다 AI 를 부르게 된다.
  // 한 번에 배치로 받아 버퍼를 넉넉히 채운다.
  const need = Math.min(
    Math.max(lookahead - remaining, REFILL_BATCH),
    MAX_AI_CARDS_PER_CALL,
  );

  const inFlight = generating.get(project.id);
  if (inFlight) {
    const generated = await inFlight;
    return { remaining: await countRemaining(project.id, user.age), generated };
  }

  const task = generateInto(user, project, need).finally(() => generating.delete(project.id));
  generating.set(project.id, task);

  const generated = await task;
  return { remaining: await countRemaining(project.id, user.age), generated };
}

/* ── 내부 ──────────────────────────────────────────────────────────── */

const CARD_COLUMNS =
  "id, keyword, intro, reason, easy_summary, category, source, min_age, created_at";

async function fetchUnreacted(
  projectId: string,
  age: number,
  size: number,
): Promise<CardRow[]> {
  const reactedIds = await reactedCardIds(projectId);

  let query = db()
    .from("keyword_cards")
    .select(CARD_COLUMNS)
    .eq("project_id", projectId)
    .lte("min_age", age)
    .order("created_at", { ascending: true })
    .limit(size);

  if (reactedIds.length > 0) query = query.not("id", "in", `(${reactedIds.join(",")})`);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CardRow[];
}

export async function countRemaining(projectId: string, age: number): Promise<number> {
  const reactedIds = await reactedCardIds(projectId);

  let query = db()
    .from("keyword_cards")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .lte("min_age", age);

  if (reactedIds.length > 0) query = query.not("id", "in", `(${reactedIds.join(",")})`);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function reactedCardIds(projectId: string): Promise<string[]> {
  const { data, error } = await db()
    .from("card_reactions")
    .select("card_id")
    .eq("project_id", projectId);
  if (error) throw error;
  return (data ?? []).map((r) => (r as { card_id: string }).card_id);
}

/** 이 프로젝트에서 이미 나온 키워드 (재노출 금지) */
async function usedKeywords(projectId: string): Promise<string[]> {
  const { data, error } = await db()
    .from("keyword_cards")
    .select("keyword")
    .eq("project_id", projectId)
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((c) => (c as { keyword: string }).keyword);
}

/** 첫 덱 — 트렌드 키워드로 즉시 채운다 (AI 대기 없음) */
async function seedFromTrend(
  user: UserRow,
  project: ProjectRow,
  size: number,
): Promise<{ count: number; usedFallback: boolean }> {
  const topic = (project.topic ?? "etc") as TopicId;
  const exclude = await usedKeywords(project.id);

  const { keywords, usedFallback } = await fetchTrending([topic], size, exclude);
  const pool = keywords.length > 0 ? keywords : await fetchDefaults([topic], size, exclude);
  if (pool.length === 0) return { count: 0, usedFallback: true };

  // 시드는 우리가 직접 작성해 넣은 목록이라 로컬 검사(금칙어 + 최소 연령)면 충분하다.
  // 모델 호출을 건너뛰므로 첫 덱이 곧바로 나온다.
  const { passed } = screenLocal(
    pool,
    (s) => ({ text: `${s.keyword} ${s.intro}`, minAge: s.min_age }),
    { userId: user.id, age: user.age, source: "card" },
  );
  if (passed.length === 0) return { count: 0, usedFallback };

  const inserted = await insertCards(
    project.id,
    user.id,
    passed.map((s) => ({
      keyword: s.keyword,
      intro: s.intro,
      reason: usedFallback ? "지금 해볼 만한 주제예요." : "요즘 많이 찾는 주제예요.",
      easy_summary: null,
      category: s.category,
      source: usedFallback ? "default" : "trend",
      min_age: s.min_age,
    })),
  );

  return { count: inserted, usedFallback };
}

/** 뒤쪽 카드 — AI 로 취향에 맞춰 만든다 */
async function generateInto(
  user: UserRow,
  project: ProjectRow,
  need: number,
): Promise<number> {
  const topic = (project.topic ?? "etc") as TopicId;

  const [{ data: history }, exclude] = await Promise.all([
    db()
      .from("card_reactions")
      .select("keyword, reaction, reacted_at")
      .eq("project_id", project.id)
      .order("reacted_at", { ascending: false })
      .limit(60),
    usedKeywords(project.id),
  ]);

  const reactions = (history ?? []) as Array<{ keyword: string; reaction: string }>;
  const likedKeywords = reactions
    .filter((r) => r.reaction === "like" || r.reaction === "detail")
    .map((r) => r.keyword);
  const passedKeywords = reactions.filter((r) => r.reaction === "pass").map((r) => r.keyword);

  const { keywords: trend } = await fetchTrending([topic], 12, exclude);

  try {
    const generated = await generateCards({
      userId: user.id,
      age: user.age,
      topic,
      customTopic: project.custom_topic,
      likedKeywords,
      passedKeywords,
      excludeKeywords: exclude,
      trendKeywords: trend.map((t) => t.keyword),
      count: need,
    });

    if (generated.length > 0) {
      return insertCards(
        project.id,
        user.id,
        generated.map((c) => ({
          keyword: c.keyword,
          intro: c.intro,
          reason: c.reason,
          easy_summary: c.easySummary,
          category: c.category,
          source: "ai",
          min_age: c.minAge,
        })),
      );
    }
  } catch (err) {
    console.error("[odot] 카드 생성 실패, 기본 풀로 대체", err);
  }

  // AI 실패 — 트렌드/기본 풀로 채운다.
  const seeded = await seedFromTrend(user, project, need);
  return seeded.count;
}

/**
 * 카드를 저장한다.
 * (project_id, keyword) 유니크 인덱스가 있어서 중복은 자동으로 걸러진다.
 */
async function insertCards(
  projectId: string,
  userId: string,
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  if (rows.length === 0) return 0;

  const { data, error } = await db()
    .from("keyword_cards")
    .upsert(
      rows.map((r) => ({ ...r, project_id: projectId, user_id: userId })),
      { onConflict: "project_id,keyword", ignoreDuplicates: true },
    )
    .select("id");

  if (error) throw error;
  return (data ?? []).length;
}
