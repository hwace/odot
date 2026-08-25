import { db } from "@/lib/supabase";
import { monthRange, previousMonth } from "@/lib/date";
import { REACTION_SCORE, REPORT_TOP_N } from "@/lib/constants";
import type { MonthlyReport, ReportKeyword } from "@/types/api";

interface ReactionRow {
  keyword: string;
  category: string | null;
  reaction: keyof typeof REACTION_SCORE;
}

/**
 * 월간 관심 키워드 정산. (F-NYHVHG)
 *
 * 그 달의 카드 반응을 키워드별로 가중 합산하고(like 3 / detail 2 / pass -1),
 * 이전 달 같은 키워드의 점수와 비교해 변화량을 낸다. 상위 5개만 노출한다.
 * 계산 결과는 monthly_reports 에 저장해 두지만, 조회할 때마다 다시 계산해서
 * 그 달 안에 반응이 더 쌓여도 항상 최신값이 나오도록 한다.
 */
export async function computeMonthlyReport(
  userId: string,
  month: string,
): Promise<MonthlyReport> {
  const [current, previous] = await Promise.all([
    fetchReactions(userId, month),
    fetchReactions(userId, previousMonth(month)),
  ]);

  const currentScores = scoreByKeyword(current);
  const previousScores = scoreByKeyword(previous);

  const topKeywords: ReportKeyword[] = [...currentScores.entries()]
    .sort((a, b) => b[1].score - a[1].score || b[1].likes - a[1].likes)
    .slice(0, REPORT_TOP_N)
    .map(([keyword, v], i) => {
      const before = previousScores.get(keyword);
      return {
        keyword,
        category: v.category,
        score: v.score,
        rank: i + 1,
        delta: before ? v.score - before.score : null,
        isNew: !before,
      };
    });

  const likeCount = current.filter((r) => r.reaction === "like").length;

  const report: MonthlyReport = {
    month,
    topKeywords,
    totalReactions: current.length,
    likeCount,
    isEmpty: current.length === 0,
    generatedAt: new Date().toISOString(),
    shareImageUrl: `/api/reports/monthly/${month}/image`,
  };

  if (!report.isEmpty) {
    await db()
      .from("monthly_reports")
      .upsert(
        {
          user_id: userId,
          year_month: month,
          top_keywords: topKeywords,
          total_reactions: report.totalReactions,
          like_count: likeCount,
          generated_at: report.generatedAt,
        },
        { onConflict: "user_id,year_month" },
      );
  }

  return report;
}

async function fetchReactions(userId: string, month: string): Promise<ReactionRow[]> {
  const { startIso, endIso } = monthRange(month);
  const { data, error } = await db()
    .from("card_reactions")
    .select("keyword, category, reaction")
    .eq("user_id", userId)
    .gte("reacted_at", startIso)
    .lt("reacted_at", endIso);
  if (error) throw error;
  return (data ?? []) as ReactionRow[];
}

function scoreByKeyword(rows: ReactionRow[]) {
  const map = new Map<string, { score: number; likes: number; category: string }>();
  for (const row of rows) {
    const prev = map.get(row.keyword);
    const weight = REACTION_SCORE[row.reaction] ?? 0;
    map.set(row.keyword, {
      score: (prev?.score ?? 0) + weight,
      likes: (prev?.likes ?? 0) + (row.reaction === "like" ? 1 : 0),
      category: prev?.category ?? row.category ?? "etc",
    });
  }
  return map;
}
