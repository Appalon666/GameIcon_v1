/**
 * Готовит новый арт обложки: замыливает водяной знак Gemini (серая звёздочка
 * в правом нижнем углу) и раскладывает результат:
 *   assets/src/cover.jpg      — оригинал арта (для истории);
 *   assets/cover.png (800×470) — обложка для карточки Яндекс Игр;
 *   public/img/hero.png        — полноразмерный чистый арт для экрана загрузки.
 *
 * Знак прячем БЛЮРОМ (по просьбе автора), а не заплаткой: регион со звездой
 * размывается сильным гауссом и накладывается обратно через растушёванную
 * круговую маску (dest-in), чтобы не было видимого шва на гладком тёмном фоне.
 * Синий боке-кружок над знаком в регион не попадает — его размывать нельзя.
 */
import sharp from 'sharp';
import { join } from 'node:path';
import { copyFile } from 'node:fs/promises';
import { ROOT } from './lib.mjs';

// Исходный арт (кладём в проект как новый источник обложки).
const SRC_INPUT = 'C:\\Users\\Константин\\Desktop\\promt\\6592ab8e-c743-4949-a481-394b19d43e0d.jpg';
const A = join(ROOT, 'assets');
const SRC = join(A, 'src', 'cover.jpg');

// Центр звёздочки и регион блюра на исходнике 1024×602 (найдено по пикселям).
const MARK = { cx: 936, cy: 512 };
const REGION = { left: 894, top: 470, size: 84 };
const BLUR_SIGMA = 14;

const bright = (r, g, b) => (r + g + b) / 3;

/** Сырая RGBA-маска: белый круг с растушёвкой alpha от coreR до size/2. */
function featherMask(size, coreR) {
  const c = size / 2;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const a = d <= coreR ? 255 : d >= c ? 0 : Math.round(255 * (1 - (d - coreR) / (c - coreR)));
      const i = (y * size + x) * 4;
      buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = a;
    }
  }
  return buf;
}

async function main() {
  // 1. Сохраняем оригинал арта в проект (перезаписывает прежнюю обложку-источник).
  await copyFile(SRC_INPUT, SRC);

  const { size, left, top } = REGION;

  // 2. Размытый регион со звездой.
  const blurred = await sharp(SRC)
    .extract({ left, top, width: size, height: size })
    .blur(BLUR_SIGMA)
    .ensureAlpha()
    .raw()
    .toBuffer();

  // 3. Растушёвываем края региона круговой маской (dest-in оставляет размытие
  //    только в центре, к краям плавно исчезает — шва на фоне не видно).
  const mask = featherMask(size, 26);
  const patch = await sharp(blurred, { raw: { width: size, height: size, channels: 4 } })
    .composite([{ input: mask, raw: { width: size, height: size, channels: 4 }, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 4. Полноразмерный чистый арт → буфер, из него и обложку, и hero.
  const cleaned = await sharp(SRC)
    .composite([{ input: patch, left, top }])
    .png()
    .toBuffer();

  await sharp(cleaned).resize(800, 470, { fit: 'fill' }).png().toFile(join(A, 'cover.png'));
  // hero — фон экрана загрузки в игре. JPEG: арт фотографичный, PNG вышел бы в
  // разы тяжелее без выигрыша в качестве.
  await sharp(cleaned).jpeg({ quality: 82, mozjpeg: true }).toFile(join(ROOT, 'public', 'img', 'hero.jpg'));

  // 5. Проверка: яркость в месте знака должна упасть до фоновой.
  const { data, info } = await sharp(cleaned).raw().toBuffer({ resolveWithObject: true });
  let maxB = 0;
  for (let y = MARK.cy - 18; y < MARK.cy + 18; y++)
    for (let x = MARK.cx - 18; x < MARK.cx + 18; x++) {
      const i = (y * info.width + x) * info.channels;
      maxB = Math.max(maxB, bright(data[i], data[i + 1], data[i + 2]));
    }
  console.log(`[cover] знак замылен в (${MARK.cx},${MARK.cy}); макс яркость после: ${Math.round(maxB)} ${maxB < 80 ? '✓' : '⚠ ещё виден'}`);
  console.log('[cover] готово: assets/cover.png (800×470), public/img/hero.jpg (1024×602)');
}

main().catch((e) => { console.error(e); process.exit(1); });
