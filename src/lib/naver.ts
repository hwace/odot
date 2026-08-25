/**
 * 네이버 데이터랩 — 검색어 트렌드 조회.
 *
 * ⚠️ 알아둘 것: 데이터랩에는 "실시간 급상승 검색어를 돌려주는" API 가 없다.
 * (네이버 실시간 검색어 서비스 자체가 2021년에 종료됐다.)
 *
 * 데이터랩이 해주는 일은 **내가 준 키워드들의 최근 검색 비율을 알려주는 것**이다.
 * 그래서 odot 은 이렇게 쓴다:
 *
 *   1. 카테고리별 후보 키워드를 DB(seed_keywords)에서 꺼낸다
 *   2. 그 후보들을 데이터랩에 넣어 최근 검색 비율을 받는다
 *   3. 비율이 높은 순으로 정렬해 카드 앞쪽에 배치한다
 *
 * 결과적으로 "요즘 실제로 많이 검색되는 주제"가 앞에 오게 된다.
 * 키가 없거나 호출이 실패하면 seed_keywords 의 기본 점수 순서로 떨어진다.
 *
 * https://developers.naver.com/docs/serviceapi/datalab/search/search.md
 */

const ENDPOINT = "https://openapi.naver.com/v1/datalab/search";

/** 데이터랩 제약: 한 번에 키워드 그룹 5개까지, 그룹당 키워드 20개까지 */
const MAX_GROUPS = 5;

export interface TrendScore {
  keyword: string;
  /** 0~100. 조회 구간에서 가장 많이 검색된 키워드가 100 */
  ratio: number;
}

export function naverConfigured(): boolean {
  return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

/**
 * 키워드들의 최근 검색 비율을 받아온다.
 * 키가 없거나 실패하면 null — 호출부는 기본 순서로 떨어지면 된다.
 */
export async function fetchSearchTrend(
  keywords: string[],
  options: { days?: number } = {},
): Promise<TrendScore[] | null> {
  if (!naverConfigured() || keywords.length === 0) return null;

  const days = options.days ?? 30;
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600_000);

  const scores: TrendScore[] = [];

  // 그룹 5개씩 끊어서 여러 번 호출한다.
  for (let i = 0; i < keywords.length; i += MAX_GROUPS) {
    const chunk = keywords.slice(i, i + MAX_GROUPS);
    const batch = await requestBatch(chunk, start, end);
    if (!batch) return scores.length > 0 ? scores : null;
    scores.push(...batch);
  }

  return scores;
}

async function requestBatch(
  keywords: string[],
  start: Date,
  end: Date,
): Promise<TrendScore[] | null> {
  const body = {
    startDate: ymd(start),
    endDate: ymd(end),
    timeUnit: "week",
    // 키워드 하나당 그룹 하나 — 그래야 키워드별 비율이 따로 나온다.
    keywordGroups: keywords.map((k) => ({ groupName: k, keywords: [k] })),
  };

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID!,
        "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.error("[odot] 데이터랩 응답 실패", res.status, await res.text().catch(() => ""));
      return null;
    }

    const json = (await res.json()) as {
      results?: Array<{ title: string; data?: Array<{ period: string; ratio: number }> }>;
    };

    return (json.results ?? []).map((r) => ({
      keyword: r.title,
      // 마지막 구간(가장 최근)의 비율을 그 키워드의 '요즘 인기'로 본다.
      ratio: r.data?.at(-1)?.ratio ?? 0,
    }));
  } catch (err) {
    console.error("[odot] 데이터랩 호출 실패", err);
    return null;
  }
}

function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
