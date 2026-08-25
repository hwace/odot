import { db } from "@/lib/supabase";
import { openai, completeJson, MODERATION_MODEL } from "@/lib/openai";
import { normalizeMinAge, policyFor, type AgePolicy } from "@/lib/age";

/**
 * 연령 검열.
 *
 * 4단계로 걸러낸다.
 *   1) 프롬프트 제약   — policy.promptGuidance 를 AI 시스템 프롬프트에 주입 (lib/ai/*)
 *   2) 금칙어 필터     — 연령대별 blockedTerms 부분 문자열 검사 (아래 checkBlocklist)
 *   3) 최소 연령 필터  — 항목에 붙은 minAge 가 사용자 나이보다 높으면 제외
 *   4) OpenAI Moderation — 남은 항목을 한 번에 배치 검사 (아래 moderateBatch)
 *
 * 2~4는 순서대로 비용이 커지므로, 싼 것부터 걸러서 API 호출량을 줄인다.
 */

export type BlockReason = "blocklist" | "min_age" | "moderation_api";

export interface ModerationVerdict {
  allowed: boolean;
  reason?: BlockReason;
  detail?: Record<string, unknown>;
}

/** 2단계: 금칙어 */
export function checkBlocklist(text: string, policy: AgePolicy): ModerationVerdict {
  const haystack = text.toLowerCase();
  const hit = policy.blockedTerms.find((term) => haystack.includes(term.toLowerCase()));
  return hit
    ? { allowed: false, reason: "blocklist", detail: { term: hit, group: policy.group } }
    : { allowed: true };
}

/** 3단계: 최소 연령 */
export function checkMinAge(minAge: unknown, age: number): ModerationVerdict {
  const required = normalizeMinAge(minAge);
  return required > age
    ? { allowed: false, reason: "min_age", detail: { required, age } }
    : { allowed: true };
}

/**
 * Moderation API 사용 가능 여부.
 * 키에 moderation 모델 권한이 없는 경우가 있어서, 한 번 실패하면 기억해 두고
 * 이후로는 곧장 채팅 모델 분류기로 간다. (403 을 매번 왕복하지 않기 위해)
 */
let moderationApiAvailable: boolean | null = null;

/**
 * 4단계: 연령 정책에 따른 배치 검사.
 *
 * 1순위는 OpenAI Moderation API. 그 모델을 쓸 수 없는 키라면
 * 채팅 모델을 분류기로 써서 같은 판단을 대신한다.
 * 둘 다 실패하면 통과시키지 않고 전부 막는다 — 미성년자가 쓰는 서비스라
 * 열어두는 쪽보다 닫는 쪽이 안전하다.
 */
export async function moderateBatch(
  texts: string[],
  policy: AgePolicy,
): Promise<ModerationVerdict[]> {
  if (texts.length === 0) return [];

  if (moderationApiAvailable !== false) {
    const viaApi = await moderateWithApi(texts, policy);
    if (viaApi) return viaApi;
  }

  const viaModel = await moderateWithModel(texts, policy);
  if (viaModel) return viaModel;

  console.error("[odot] 검열 수단이 모두 실패 — 전부 차단");
  return texts.map(() => ({
    allowed: false,
    reason: "moderation_api" as const,
    detail: { error: "moderation_unavailable" },
  }));
}

/** 1순위: OpenAI Moderation API. 쓸 수 없으면 null 을 돌려 다음 수단으로 넘긴다. */
async function moderateWithApi(
  texts: string[],
  policy: AgePolicy,
): Promise<ModerationVerdict[] | null> {
  type RawResult = {
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  };

  let results: RawResult[];
  try {
    const res = await openai().moderations.create({
      model: MODERATION_MODEL,
      input: texts,
    });
    results = res.results as unknown as RawResult[];
    moderationApiAvailable = true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    // 403/404 = 이 키로는 moderation 모델을 못 쓴다. 다시 시도할 필요 없다.
    if (status === 403 || status === 404) {
      moderationApiAvailable = false;
      console.warn("[odot] moderation 모델 권한 없음 — 채팅 모델 분류기로 전환");
    } else {
      console.error("[odot] moderation api 실패", err);
    }
    return null;
  }

  return results.map((r) => {
    const violated = policy.blockedModerationCategories.filter((cat) => {
      const score = r.category_scores?.[cat] ?? 0;
      return r.categories?.[cat] === true || score >= policy.moderationThreshold;
    });
    return violated.length > 0
      ? {
          allowed: false,
          reason: "moderation_api" as const,
          detail: { categories: violated, group: policy.group, via: "api" },
        }
      : { allowed: true };
  });
}

/**
 * 2순위: 채팅 모델을 분류기로 쓴다.
 * 생성용 프롬프트와 완전히 분리된 호출이라, 생성 쪽 지시가 판정에 섞이지 않는다.
 */
async function moderateWithModel(
  texts: string[],
  policy: AgePolicy,
): Promise<ModerationVerdict[] | null> {
  const system = [
    "너는 청소년도 사용하는 서비스의 콘텐츠 심사원이다.",
    `심사 대상 사용자는 ${policy.label}이다.`,
    "각 항목이 이 연령대에게 보여줘도 되는 활동 추천인지 판정한다.",
    "",
    "다음 중 하나라도 해당하면 차단이다:",
    ...policy.blockedModerationCategories.map((c) => `- ${CATEGORY_DESCRIPTION[c] ?? c}`),
    "- 그 밖에 해당 연령대가 하기에 안전하지 않거나 법적으로 허용되지 않는 활동",
    "",
    "판단이 애매하면 차단한다.",
    "",
    '출력은 JSON 객체 하나: {"results":[{"index":0,"blocked":false,"reason":""}]}',
    "results 는 입력 항목과 같은 개수, 같은 순서여야 한다.",
    "reason 은 차단일 때만 짧은 한국어로 적는다.",
  ].join("\n");

  const user = texts.map((t, i) => `${i}. ${t}`).join("\n");

  try {
    const payload = await completeJson<{
      results?: Array<{ index?: number; blocked?: boolean; reason?: string }>;
    }>({ system, user });

    const results = payload?.results;
    if (!Array.isArray(results) || results.length !== texts.length) {
      console.error("[odot] 분류기 응답 개수 불일치", results?.length, texts.length);
      return null;
    }

    return texts.map((_, i) => {
      const row = results.find((r) => r.index === i) ?? results[i];
      return row?.blocked
        ? {
            allowed: false,
            reason: "moderation_api" as const,
            detail: { group: policy.group, via: "model", reason: row.reason ?? "" },
          }
        : { allowed: true };
    });
  } catch (err) {
    console.error("[odot] 채팅 모델 분류기 실패", err);
    return null;
  }
}

/** Moderation 카테고리 이름을 분류기가 이해할 한국어 설명으로 */
const CATEGORY_DESCRIPTION: Record<string, string> = {
  sexual: "성적인 내용",
  "sexual/minors": "미성년자가 관련된 성적인 내용",
  violence: "폭력",
  "violence/graphic": "잔인하거나 노골적인 폭력 묘사",
  "self-harm": "자해나 자살",
  "self-harm/intent": "자해 의도의 표현",
  "self-harm/instructions": "자해 방법 안내",
  hate: "특정 집단에 대한 혐오",
  "hate/threatening": "혐오에 기반한 위협",
  harassment: "괴롭힘",
  "harassment/threatening": "위협을 동반한 괴롭힘",
  illicit: "불법 행위",
};

/**
 * 로컬 검사만 수행한다 (2~3단계: 금칙어 + 최소 연령).
 *
 * 우리가 직접 작성해 DB에 넣어 둔 시드 키워드처럼 **이미 검증된 콘텐츠**에 쓴다.
 * 모델 호출이 없어서 즉시 끝나므로, 첫 카드 덱을 기다리지 않게 하는 데 중요하다.
 * AI가 생성한 콘텐츠에는 절대 이걸 쓰지 말고 screen() 을 써야 한다.
 */
export function screenLocal<T>(
  items: T[],
  toScreenItem: (item: T) => ScreenItem,
  ctx: { userId: string | null; age: number; source: string },
): ScreenOutcome<T> {
  const policy = policyFor(ctx.age);
  const passed: T[] = [];
  const blocked: ScreenOutcome<T>["blocked"] = [];

  for (const item of items) {
    const { text, minAge } = toScreenItem(item);

    const byAge = checkMinAge(minAge, ctx.age);
    if (!byAge.allowed) {
      blocked.push({ item, reason: byAge.reason!, detail: byAge.detail });
      continue;
    }

    const byList = checkBlocklist(text, policy);
    if (!byList.allowed) {
      blocked.push({ item, reason: byList.reason!, detail: byList.detail });
      continue;
    }

    passed.push(item);
  }

  if (blocked.length > 0) void logBlocked(blocked, toScreenItem, ctx, policy.group);
  return { passed, blocked };
}

export interface ScreenItem {
  /** 검열 대상 텍스트 전체 (키워드 + 소개 + 근거 등을 이어붙인 것) */
  text: string;
  minAge?: unknown;
}

export interface ScreenOutcome<T> {
  passed: T[];
  blocked: Array<{ item: T; reason: BlockReason; detail?: Record<string, unknown> }>;
}

/**
 * 항목 배열을 연령 정책으로 한 번에 거른다.
 * 차단된 항목은 moderation_logs 에 기록되어 나중에 기준을 조정할 수 있다.
 */
export async function screen<T>(
  items: T[],
  toScreenItem: (item: T) => ScreenItem,
  ctx: { userId: string | null; age: number; source: string },
): Promise<ScreenOutcome<T>> {
  const policy = policyFor(ctx.age);
  const passed: T[] = [];
  const blocked: ScreenOutcome<T>["blocked"] = [];

  // 2~3단계: 값싼 로컬 검사
  const survivors: T[] = [];
  for (const item of items) {
    const { text, minAge } = toScreenItem(item);

    const byAge = checkMinAge(minAge, ctx.age);
    if (!byAge.allowed) {
      blocked.push({ item, reason: byAge.reason!, detail: byAge.detail });
      continue;
    }

    const byList = checkBlocklist(text, policy);
    if (!byList.allowed) {
      blocked.push({ item, reason: byList.reason!, detail: byList.detail });
      continue;
    }

    survivors.push(item);
  }

  // 4단계: 남은 것만 API 검사
  const verdicts = await moderateBatch(survivors.map((s) => toScreenItem(s).text), policy);
  survivors.forEach((item, i) => {
    const v = verdicts[i];
    if (v?.allowed) passed.push(item);
    else blocked.push({ item, reason: v?.reason ?? "moderation_api", detail: v?.detail });
  });

  if (blocked.length > 0) {
    void logBlocked(blocked, toScreenItem, ctx, policy.group);
  }

  return { passed, blocked };
}

async function logBlocked<T>(
  blocked: ScreenOutcome<T>["blocked"],
  toScreenItem: (item: T) => ScreenItem,
  ctx: { userId: string | null; age: number; source: string },
  ageGroup: string,
) {
  try {
    await db()
      .from("moderation_logs")
      .insert(
        blocked.map((b) => ({
          user_id: ctx.userId,
          age: ctx.age,
          age_group: ageGroup,
          source: ctx.source,
          content: toScreenItem(b.item).text.slice(0, 2000),
          reason: b.reason,
          detail: b.detail ?? {},
        })),
      );
  } catch (err) {
    // 로깅 실패가 사용자 요청을 망치면 안 된다.
    console.error("[odot] moderation log insert failed", err);
  }
}

/** 사용자가 직접 입력한 텍스트(기타 관심사 등) 단건 검사 */
export async function screenUserInput(
  text: string,
  ctx: { userId: string | null; age: number; source: string },
): Promise<ModerationVerdict> {
  const policy = policyFor(ctx.age);

  const byList = checkBlocklist(text, policy);
  if (!byList.allowed) {
    void logBlocked([{ item: text, reason: byList.reason!, detail: byList.detail }], (t) => ({ text: t }), ctx, policy.group);
    return byList;
  }

  const [verdict] = await moderateBatch([text], policy);
  if (verdict && !verdict.allowed) {
    void logBlocked([{ item: text, reason: verdict.reason!, detail: verdict.detail }], (t) => ({ text: t }), ctx, policy.group);
  }
  return verdict ?? { allowed: true };
}
