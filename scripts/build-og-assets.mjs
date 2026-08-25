/**
 * 스토리 공유 이미지에 넣을 그림을 미리 잘라 둔다.
 *
 * next/og(satori)는 파일 하나를 통째로 넣는 편이 안전해서, 스프라이트를
 * 런타임에 잘라 쓰지 않고 여기서 미리 잘라 `src/og-assets/` 에 넣는다.
 * 자산 원본이 바뀌면 `npm run build:og-assets` 로 다시 만든다.
 */
import sharp from "sharp";

const OUT = "src/og-assets";

// 로고 앞쪽 'o' — 스프라이트 1행 2열의 웃는 얼굴.
// app.html 의 .logo-o 가 보여주는 그 얼굴이다.
//
// 덩어리가 둥글어서 네모로 자르면 모서리에 흰 배경이 딸려 온다.
// satori 는 이미지 안쪽을 다듬어 주지 않으니 여기서 흰 픽셀을 분홍으로
// 덮어 두고 넘긴다. 이러면 어떤 크기로 그려도 모서리가 깨끗하다.
const PINK = [240, 160, 161]; // #f0a0a1 — .logo-o 의 바탕색
const face = await sharp("public/assets/odot-characters.png")
  .extract({ left: 280, top: 40, width: 165, height: 165 })
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

for (let i = 0; i < face.data.length; i += 3) {
  const [r, g, b] = [face.data[i], face.data[i + 1], face.data[i + 2]];
  // 흰 여백이거나, 옆 칸 빨간 덩어리가 걸쳐 들어온 자리를 분홍으로 덮는다.
  const isPaper = r > 228 && g > 228 && b > 228;
  const isNeighbour = r > 180 && g < 110 && b < 110;
  if (isPaper || isNeighbour) [face.data[i], face.data[i + 1], face.data[i + 2]] = PINK;
}

await sharp(face.data, { raw: { width: 165, height: 165, channels: 3 } })
  .resize(256, 256)
  .png()
  .toFile(`${OUT}/logo-a.png`);

// 뒤쪽 'o' 는 시안처럼 무늬 없는 초록 원이라 그림이 필요 없다. (#80ad99)

// 오른쪽 아래에 앉는 돋보기 캐릭터.
const trimmed = await sharp("public/assets/category-culture.png")
  .trim({ threshold: 12 })
  .toBuffer({ resolveWithObject: true });
await sharp(trimmed.data).resize({ width: 620 }).png({ compressionLevel: 9 }).toFile(`${OUT}/character.png`);

for (const name of ["logo-a.png", "character.png"]) {
  const m = await sharp(`${OUT}/${name}`).metadata();
  const { size } = await import("node:fs").then((fs) => fs.statSync(`${OUT}/${name}`));
  console.log(name.padEnd(16), `${m.width}x${m.height}`, `${(size / 1024).toFixed(0)}KB`);
}
