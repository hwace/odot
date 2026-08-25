import { db } from "@/lib/supabase";
import { fetchSearchTrend, naverConfigured } from "@/lib/naver";
import type { TopicId } from "@/types/api";

export interface SeedKeyword {
  keyword: string;
  category: TopicId;
  intro: string;
  source: "trend" | "default";
  min_age: number;
  score: number;
}

/** 데이터랩 순위를 이 시간 동안은 다시 묻지 않는다 */
const TREND_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 카드 앞쪽(1~5번)을 채울 트렌드 키워드.
 *
 * seed_keywords 의 후보들을 네이버 데이터랩에 넣어 최근 검색 비율을 받고,
 * 높은 순으로 정렬해서 돌려준다. AI 호출이 없으므로 즉시 나온다 —
 * 첫 카드를 기다리지 않아도 되는 게 이 경로의 핵심이다.
 *
 * 데이터랩 키가 없거나 호출이 실패하면 seed_keywords 의 기본 점수 순서로 떨어진다.
 * (PRD 예외 규칙: "트렌드 키워드 API 호출에 실패하면 기본 키워드 카드를 표시한다")
 */
export async function fetchTrending(
  categories: TopicId[],
  limit = 12,
  exclude: string[] = [],
): Promise<{ keywords: SeedKeyword[]; usedFallback: boolean }> {
  const pool = await selectSeeds(categories, limit * 3, exclude);
  if (pool.length === 0) return { keywords: [], usedFallback: true };

  const ranked = await rankByTrend(pool);
  return {
    keywords: ranked.keywords.slice(0, limit),
    usedFallback: ranked.usedFallback,
  };
}

/** 트렌드까지 실패했을 때 마지막으로 쓰는 기본 키워드 풀 */
export async function fetchDefaults(
  categories: TopicId[],
  limit = 10,
  exclude: string[] = [],
): Promise<SeedKeyword[]> {
  const pool = await selectSeeds(categories, limit, exclude).catch(() => []);
  return pool.slice(0, limit);
}

/**
 * 데이터랩으로 후보 키워드의 최근 검색 비율을 받아 정렬한다.
 * 이미 최근에 조회한 값이 DB에 있으면 그걸 쓰고, 없으면 새로 물어본 뒤 저장한다.
 */
async function rankByTrend(
  pool: SeedKeyword[],
): Promise<{ keywords: SeedKeyword[]; usedFallback: boolean }> {
  if (!naverConfigured()) {
    return { keywords: sortByScore(pool), usedFallback: true };
  }

  const fresh = await loadCachedRatios(pool.map((p) => p.keyword));
  const missing = pool.filter((p) => !fresh.has(p.keyword)).map((p) => p.keyword);

  if (missing.length > 0) {
    const scores = await fetchSearchTrend(missing);
    if (scores) {
      for (const s of scores) fresh.set(s.keyword, s.ratio);
      void saveRatios(scores);
    }
  }

  if (fresh.size === 0) {
    return { keywords: sortByScore(pool), usedFallback: true };
  }

  const ranked = [...pool].sort((a, b) => {
    const ra = fresh.get(a.keyword);
    const rb = fresh.get(b.keyword);
    // 트렌드 값이 있는 쪽이 먼저, 그다음 기본 점수
    if (ra !== undefined && rb !== undefined) return rb - ra || b.score - a.score;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return b.score - a.score;
  });

  return { keywords: ranked, usedFallback: false };
}

async function loadCachedRatios(keywords: string[]): Promise<Map<string, number>> {
  const since = new Date(Date.now() - TREND_TTL_MS).toISOString();
  const { data, error } = await db()
    .from("seed_keywords")
    .select("keyword, trend_ratio, trend_checked_at")
    .in("keyword", keywords)
    .not("trend_ratio", "is", null)
    .gte("trend_checked_at", since);

  if (error) return new Map();

  const rows = (data ?? []) as Array<{ keyword: string; trend_ratio: number }>;
  return new Map(rows.map((r) => [r.keyword, Number(r.trend_ratio)]));
}

async function saveRatios(scores: Array<{ keyword: string; ratio: number }>) {
  const now = new Date().toISOString();
  try {
    await Promise.all(
      scores.map((s) =>
        db()
          .from("seed_keywords")
          .update({ trend_ratio: s.ratio, trend_checked_at: now })
          .eq("keyword", s.keyword),
      ),
    );
  } catch (err) {
    console.error("[odot] 트렌드 점수 저장 실패", err);
  }
}

async function selectSeeds(
  categories: TopicId[],
  limit: number,
  exclude: string[],
): Promise<SeedKeyword[]> {
  let query = db()
    .from("seed_keywords")
    .select("keyword, category, intro, source, min_age, score")
    .order("score", { ascending: false })
    .limit(limit);

  if (categories.length > 0) query = query.in("category", categories);
  if (exclude.length > 0) {
    // PostgREST 의 in 필터에 넣기 위해 쉼표·괄호를 피해 인용한다.
    const quoted = exclude.map((k) => `"${k.replace(/"/g, '')}"`).join(",");
    query = query.not("keyword", "in", `(${quoted})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SeedKeyword[];
}

function sortByScore(pool: SeedKeyword[]): SeedKeyword[] {
  return [...pool].sort((a, b) => b.score - a.score);
}
