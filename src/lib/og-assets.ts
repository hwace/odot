import fs from "node:fs";
import path from "node:path";

/**
 * 공유 이미지에 쓰는 폰트와 그림.
 *
 * next/og(satori)는 시스템 폰트를 쓰지 않는다. 폰트를 직접 넘기지 않으면
 * 배포된 리눅스에서 한글이 전부 네모로 나온다. 그래서 Pretendard 를
 * 한글·라틴만 남겨 추려 두고 여기서 읽어 넘긴다.
 *
 * 그림도 마찬가지로 data URI 로 박아 넣는다. 런타임에 public/ 을 다시
 * 받아오면 콜드 스타트마다 왕복이 생기고, 서버리스 번들에는 public/ 이
 * 들어가지도 않는다.
 *
 * 파일은 `src/og-assets/` 에 있고 next.config.ts 의 outputFileTracingIncludes
 * 로 번들에 포함시킨다. 그림 원본이 바뀌면 `npm run build:og-assets`.
 */
const DIR = path.join(process.cwd(), "src/og-assets");

type Assets = { font: Buffer; logo: string; character: string };

// 모듈 스코프 캐시 — 콜드 스타트에 한 번만 읽는다.
let cached: Assets | null = null;

export function ogAssets(): Assets {
  if (!cached) {
    const png = (name: string) =>
      `data:image/png;base64,${fs.readFileSync(path.join(DIR, name)).toString("base64")}`;
    cached = {
      font: fs.readFileSync(path.join(DIR, "Pretendard-ExtraBold.subset.ttf")),
      logo: png("logo-a.png"),
      character: png("character.png"),
    };
  }
  return cached;
}
