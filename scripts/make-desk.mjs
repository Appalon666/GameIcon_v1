/**
 * Обои стартового экрана: свёрстанный и слегка размытый «рабочий стол»,
 * запечённый в картинку. Размывать живьём CSS-фильтром на весь экран —
 * дорого для слабых телефонов, а картинка в рантайме не стоит ничего.
 *
 * Два варианта под ориентацию (переключает CSS, см. .desk в style.css):
 *   - ландшафт 1600x1000 — колонки ярлыков слева и два окна справа, как на
 *     столе компьютера;
 *   - портрет 1000x1600 — домашний экран телефона: сетка значков и док.
 * Ярлыки — иконки игр из своего же набора (data/bundle.json), подписи под
 * ними — серые полоски: читать там нечего, это фон. Отбор с сидом, чтобы
 * обои были воспроизводимы, а не менялись при каждой сборке.
 *
 * Запуск: node scripts/make-desk.mjs → public/img/desk-land.jpg, desk-port.jpg
 */
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ROOT, DATA, IMG } from './lib.mjs';

/** Генератор с сидом: тот же набор ярлыков при каждом запуске. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Подложка: те же два косых источника света, что у body в CSS. */
const wallpaper = (w, h) => `
  <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#151b2a"/><stop offset="1" stop-color="#0b0e15"/>
      </linearGradient>
      <radialGradient id="g1" cx="18%" cy="8%" r="55%">
        <stop offset="0" stop-color="#2b4a8a" stop-opacity="0.55"/><stop offset="1" stop-color="#2b4a8a" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="g2" cx="88%" cy="20%" r="50%">
        <stop offset="0" stop-color="#4a2f7a" stop-opacity="0.45"/><stop offset="1" stop-color="#4a2f7a" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#base)"/>
    <rect width="100%" height="100%" fill="url(#g1)"/>
    <rect width="100%" height="100%" fill="url(#g2)"/>
  </svg>`;

/** Окно: полотно, строка заголовка с тремя точками, пара «строк» содержимого. */
const windowSvg = (w, h) => `
  <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="#1a202c" fill-opacity="0.92" stroke="#ffffff" stroke-opacity="0.13"/>
    <path d="M14 0.5 H${w - 14} a13.5 13.5 0 0 1 13.5 13.5 V36 H0.5 V14 A13.5 13.5 0 0 1 14 0.5 Z" fill="#2c3546"/>
    <circle cx="20" cy="18" r="4.5" fill="#ffffff" fill-opacity="0.17"/>
    <circle cx="34" cy="18" r="4.5" fill="#ffffff" fill-opacity="0.17"/>
    <circle cx="48" cy="18" r="4.5" fill="#ffffff" fill-opacity="0.17"/>
    <rect x="64" y="13" width="${Math.round(w * 0.22)}" height="10" rx="3" fill="#ffffff" fill-opacity="0.14"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="24" y="${64 + i * 46}" width="${Math.round(w * (0.5 + ((i * 37) % 30) / 100))}" height="14" rx="4" fill="#ffffff" fill-opacity="${i === 1 ? 0.16 : 0.07}"/>`).join('')}
  </svg>`;

/** Подпись под ярлыком — серая полоска. */
const labelSvg = (w, h) => `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="${h / 2}" fill="#ffffff" fill-opacity="0.16"/></svg>`;

/** Док телефона: скруглённая полупрозрачная плашка. */
const dockSvg = (w, h) => `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="${Math.round(h / 3)}" fill="#ffffff" fill-opacity="0.09"/></svg>`;

async function pickIcons(n, seed) {
  const bundle = JSON.parse(await readFile(join(DATA, 'bundle.json'), 'utf8'));
  const ids = bundle.icons.map(([id]) => id);
  const rand = rng(seed);
  // Тасуем копию и берём первые n: без повторов.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, n).map((id) => join(IMG, 'icons', `${id}.png`));
}

/** Иконка нужного размера со скруглёнными углами. */
async function iconTile(file, size) {
  const r = Math.round(size * 0.22);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`);
  return sharp(file)
    .resize(size, size, { fit: 'cover' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/**
 * @param {number} dim затемнение поверх всего, 0..1: ярлыки и окна — фон, они
 *   не должны спорить с настоящими окнами и заголовком поверх них
 */
async function render({ w, h, blur, dim, out, place }) {
  const layers = await place();
  layers.push({
    input: Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#05070c" fill-opacity="${dim}"/></svg>`),
    left: 0,
    top: 0,
  });
  await sharp(Buffer.from(wallpaper(w, h)))
    .composite(layers)
    .blur(blur)
    .modulate({ brightness: 0.6, saturation: 0.85 })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(out);
  const { size } = await sharp(out).metadata().then(() => import('node:fs/promises').then((fs) => fs.stat(out)));
  console.log(`[desk] ${out.replace(ROOT, '').replace(/\\/g, '/')} — ${(size / 1024).toFixed(0)} КБ`);
}

// Ландшафт: три колонки ярлыков слева, два окна справа.
await render({
  w: 1600, h: 1000, blur: 4, dim: 0.3, out: join(IMG, 'desk-land.jpg'),
  place: async () => {
    const files = await pickIcons(24, 7);
    const layers = [];
    let k = 0;
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 8; r++) {
        const x = 56 + c * 124;
        const y = 44 + r * 118;
        layers.push({ input: await iconTile(files[k++], 64), left: x, top: y });
        layers.push({ input: Buffer.from(labelSvg(66 - (k % 3) * 8, 9)), left: x - 1 + (k % 3) * 4, top: y + 74 });
      }
    }
    layers.push({ input: Buffer.from(windowSvg(760, 520)), left: 760, top: 200 });
    layers.push({ input: Buffer.from(windowSvg(520, 400)), left: 1060, top: 430 });
    return layers;
  },
});

// Портрет: домашний экран телефона — сетка 5x4 в нижней половине и док.
// Верхняя треть пустая намеренно: там на экране лежит заголовок игры, и сетка
// значков под ним делала его шумным.
await render({
  w: 1000, h: 1600, blur: 5.5, dim: 0.38, out: join(IMG, 'desk-port.jpg'),
  place: async () => {
    const files = await pickIcons(24, 11);
    const layers = [];
    let k = 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        const x = 78 + c * 178;
        const y = 560 + r * 186;
        layers.push({ input: await iconTile(files[k++], 84), left: x + 6, top: y });
        layers.push({ input: Buffer.from(labelSvg(78 - (k % 3) * 10, 10)), left: x + 9 + (k % 3) * 5, top: y + 96 });
      }
    }
    layers.push({ input: Buffer.from(dockSvg(840, 150)), left: 80, top: 1380 });
    for (let c = 0; c < 4; c++) {
      layers.push({ input: await iconTile(files[k++], 84), left: 164 + c * 190, top: 1413 });
    }
    return layers;
  },
});
