import { ok, withRoute } from "@/lib/http";
import { TOPIC_OPTIONS } from "@/lib/constants";

/**
 * GET /api/topics — 관심사 카드 7종 (라벨/색 포함)
 *
 * 새 프로젝트를 시작할 때 이 중 정확히 하나를 골라 POST /api/projects 로 보낸다.
 */
export const GET = withRoute(async () => ok({ topics: TOPIC_OPTIONS }));
