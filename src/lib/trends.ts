import { db } from "@/lib/supabase";
import type { TopicId } from "@/types/api";

export interface SeedKeyword {
  keyword: string;
  category: TopicId;
  intro: string;
  min_age: number;
  score: number;
}

/**
 * 카드 앞쪽(1~5번)을 채우는 큐레이션 키워드 풀.
 *
 * seed_keywords 테이블에서 카테고리에 맞는 키워드를 점수 순으로 꺼낸다.
 * AI 호출이 없으므로 즉시 나온다 — 첫 카드를 기다리지 않아도 되는 게 이 경로의 핵심이다.
 *
 * 상위권만 그대로 쓰면 매번 같은 카드가 나오므로, 넉넉히 뽑아 섞은 뒤 필요한 만큼만 쓴다.
 */
export async function fetchSeedKeywords(
  categories: TopicId[],
  limit = 12,
  exclude: string[] = [],
): Promise<SeedKeyword[]> {
  let query = db()
    .from("seed_keywords")
    .select("keyword, category, intro, min_age, score")
    .order("score", { ascending: false })
    .limit(limit * 3);

  if (categories.length > 0) query = query.in("category", categories);
  if (exclude.length > 0) {
    // PostgREST 의 in 필터에 넣기 위해 각 값을 인용한다.
    const quoted = exclude.map((k) => `"${k.replace(/"/g, "")}"`).join(",");
    query = query.not("keyword", "in", `(${quoted})`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return shuffle((data ?? []) as SeedKeyword[]).slice(0, limit);
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
