/**
 * Убирает водяной знак (серая звёздочка Gemini) с ассетов из assets/src/ и
 * кладёт готовые картинки для карточки Яндекс Игр: assets/icon.png (512×512) и
 * assets/cover.png (800×470).
 *
 * Знак ищется по пикселям (серое пятно яркостью ~90 в правом нижнем углу) и
 * закрывается заплаткой из цвета соседнего тёмного фона. Заплатка строится
 * СЫРЫМ RGBA-буфером (круг с растушёвкой) — SVG-градиент librsvg рендерил почти
 * прозрачным. После наложения проверяем, что яркость в месте знака упала.
 */
import sharp from 'sharp';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const A = join(ROOT, 'assets');
const bright = (r, g, b) => (r + g + b) / 3;
const grey = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 24;

/** Центроид серого пятна знака в правом нижнем углу. */
async function findMark(src) {
  const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let sx = 0, sy = 0, sw = 0;
  let mx = 0, my = 0, mb = 0;
  for (let y = Math.round(height * 0.8); y < height; y++) {
    for (let x = Math.round(width * 0.8); x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const B = bright(r, g, b);
      if (B > 78 && B < 150 && grey(r, g, b)) {
        const w = B - 74;
        sx += x * w; sy += y * w; sw += w;
        if (B > mb) { mb = B; mx = x; my = y; }
      }
    }
  }
  if (!mb) return null;
  // Центр — самый яркий серый пиксель (это и есть звёздочка): центроид тянет
  // серая рамка плитки рядом. Пик надёжнее.
  return { cx: mx, cy: my, width, height };
}

/** Средний цвет тёмного участка рядом (для цвета заплатки). */
async function bgColor(src, x, y) {
  const st = await sharp(src).extract({ left: x - 10, top: y - 10, width: 20, height: 20 }).stats();
  return st.channels.slice(0, 3).map((c) => Math.round(c.mean));
}

/** Сырой RGBA-круг цвета col с растушёвкой от coreR до радиуса size/2. */
function rawCircle(size, coreR, [r, g, b]) {
  const c = size / 2;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const a = d <= coreR ? 255 : d >= c ? 0 : Math.round(255 * (1 - (d - coreR) / (c - coreR)));
      const i = (y * size + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    }
  }
  return buf;
}

async function clean(name, out, w, h, override) {
  const src = join(A, 'src', `${name}.jpg`);
  const meta = await sharp(src).metadata();
  // Позиция знака задана вручную по карте пикселей — авто-детект по яркому
  // серому пикселю промахивался (притягивала серая рамка плитки).
  const mark = override
    ? { cx: override[0], cy: override[1], width: meta.width, height: meta.height }
    : await findMark(src);
  if (!mark) throw new Error(`знак не найден на ${name}`);
  const { cx, cy, width, height } = mark;

  const half = Math.min(78, cx, width - cx, cy, height - cy);
  const size = half * 2;
  const coreR = Math.min(48, half - 12);

  // Цвет фона — из тёмной точки в сторону угла от знака.
  const bx = Math.min(cx + 50, width - 12);
  const by = Math.min(cy + 40, height - 12);
  const col = await bgColor(src, bx, by);

  const patch = await sharp(rawCircle(size, coreR, col), { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();

  // ВАЖНО: composite и resize — в РАЗНЫХ конвейерах. В одной цепочке sharp
  // применяет resize раньше composite, и заплатка встаёт по координатам
  // исходника уже на уменьшенной картинке (мимо кадра). Поэтому сначала
  // накладываем на полном размере в буфер, потом отдельно ресайзим.
  const patched = await sharp(src)
    .composite([{ input: patch, left: cx - half, top: cy - half }])
    .png()
    .toBuffer();
  // removeAlpha: заплатка накладывается RGBA, и без этого в готовом файле
  // остаётся альфа-канал. Требования к иконке и обложке (п. 8.3.3) — PNG без
  // прозрачности и с прямыми углами; канал полностью непрозрачный, но повода
  // для придирки лучше не оставлять.
  await sharp(patched).resize(w, h, { fit: 'fill' }).removeAlpha().png().toFile(join(A, out));

  // Проверка: яркость в месте знака должна упасть до фоновой.
  const { data, info } = await sharp(join(A, out)).raw().toBuffer({ resolveWithObject: true });
  const ox = Math.round((cx / width) * w);
  const oy = Math.round((cy / height) * h);
  let maxB = 0;
  for (let y = Math.max(0, oy - 18); y < Math.min(info.height, oy + 18); y++)
    for (let x = Math.max(0, ox - 18); x < Math.min(info.width, ox + 18); x++) {
      const i = (y * info.width + x) * info.channels;
      maxB = Math.max(maxB, bright(data[i], data[i + 1], data[i + 2]));
    }
  console.log(`[assets] ${out} ${w}×${h} — знак в (${cx},${cy}), фон ${JSON.stringify(col)}, макс яркость после: ${Math.round(maxB)} ${maxB < 70 ? '✓' : '⚠ ещё виден'}`);
}

async function main() {
  await clean('icon', 'icon.png', 512, 512, [894, 897]);
  await clean('cover', 'cover.png', 800, 470, [927, 507]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
