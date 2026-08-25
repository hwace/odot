import OpenAI from "openai";
import { ApiError } from "@/lib/http";

let cached: OpenAI | null = null;

export function openai(): OpenAI {
  if (cached) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ApiError(
      "AI_FAILED",
      "AI 설정이 완료되지 않았습니다. 잠시 후 다시 시도해주세요.",
      { hint: "OPENAI_API_KEY 환경변수가 비어 있습니다." },
    );
  }
  cached = new OpenAI({ apiKey });
  return cached;
}

export const MODEL = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
export const MODERATION_MODEL =
  process.env.OPENAI_MODERATION_MODEL ?? "omni-moderation-latest";

/**
 * temperature 는 기본적으로 보내지 않는다.
 * 최신 모델 중에는 기본값(1) 외의 temperature 를 거부하는 것들이 있어서,
 * 모델을 바꿀 때마다 요청이 깨지는 것보다 안 보내는 쪽이 안전하다.
 * 굳이 조절하고 싶으면 OPENAI_TEMPERATURE 로 지정한다.
 */
const TEMPERATURE = process.env.OPENAI_TEMPERATURE
  ? Number(process.env.OPENAI_TEMPERATURE)
  : undefined;

/**
 * JSON 응답을 강제해서 한 번 호출한다.
 * 파싱 실패나 API 오류는 전부 AI_FAILED 로 올려서, 프론트가
 * "다시 생성하기" 버튼 하나로 대응할 수 있게 한다. (F-PEBLKV 예외 규칙)
 */
export async function completeJson<T>(args: {
  system: string;
  user: string;
  /** 프로젝트별 세션 키. 같은 프로젝트의 호출만 같은 값을 쓴다. */
  sessionKey?: string;
}): Promise<T> {
  const client = openai();

  let raw: string | null | undefined;
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      ...(TEMPERATURE === undefined ? {} : { temperature: TEMPERATURE }),
      ...(args.sessionKey ? { user: args.sessionKey } : {}),
    });
    raw = res.choices[0]?.message?.content;
  } catch (err) {
    console.error("[odot] openai request failed", err);
    throw new ApiError("AI_FAILED", "AI 생성에 실패했습니다. 다시 시도해주세요.");
  }

  if (!raw) {
    throw new ApiError("AI_FAILED", "AI 응답이 비어 있습니다. 다시 시도해주세요.");
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error("[odot] openai returned non-JSON", raw.slice(0, 500));
    throw new ApiError("AI_FAILED", "AI 응답을 읽지 못했습니다. 다시 시도해주세요.");
  }
}
