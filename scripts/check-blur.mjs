/**
 * Проверка замыливания названий — на живой игре, тем же кодом, что рисует кадр.
 *
 * Проверяется три вещи, и все три важны по отдельности:
 *   1. Название действительно скрыто: резкость (сумма перепадов яркости между
 *      соседними пикселями) в области падает в разы. Буквы — это перепады;
 *      нет перепадов — нет букв.
 *   2. Это именно блюр, а не заливка: в области остаётся разброс цвета. Чёрный
 *      прямоугольник тоже прошёл бы первую проверку, но выглядит как дыра в
 *      кадре — от него и уходили.
 *   3. Соседний кусок кадра не пострадал: рядом с областью резкость прежняя,
 *      то есть мыло не растеклось за рамку.
 *
 * Нужен дев-сервер: npm run serve. Запуск: node scripts/check-blur.mjs
 */
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { chromePath } from './lib.mjs';
import { DATA, readJSON } from './lib.mjs';

const CHROME = chromePath();
const URL = `http://localhost:${process.env.PORT || 8080}/`;
/** Во сколько раз резкость обязана упасть, чтобы считать надпись скрытой. */
const MIN_DROP = 3;
/** Ниже этого разброса цвета область неотличима от заливки. */
const MIN_SPREAD = 2;

const results = [];
const check = (item, ok, detail) => {
  results.push({ item, ok, detail });
  console.log(`${ok ? '[ ОК ]' : '[ПРОВАЛ]'} ${item}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Считает в области две величины: резкость (средний перепад между соседями по
 * горизонтали) и разброс (стандартное отклонение яркости).
 */
const MEASURE = `(canvas, r) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const x = Math.round(r.x * canvas.width);
  const y = Math.round(r.y * canvas.height);
  const w = Math.max(2, Math.round(r.w * canvas.width));
  const h = Math.max(2, Math.round(r.h * canvas.height));
  const { data } = ctx.getImageData(x, y, w, h);
  let edge = 0;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = (row * w + col) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += lum;
      sum2 += lum * lum;
      n++;
      if (col + 1 < w) {
        const j = i + 4;
        const lum2 = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
        edge += Math.abs(lum - lum2);
      }
    }
  }
  const mean = sum / n;
  return { edge: edge / n, spread: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}`;

async function main() {
  const shots = (await readJSON(join(DATA, 'shots.json')))?.shots ?? [];
  const marked = shots.filter((s) => s.blur?.length);
  if (!marked.length) {
    console.error('в данных нет ни одной области блюра — проверять нечего');
    process.exit(1);
  }
  // Берём разные по характеру кадры: тёмный, светлый, с крупной надписью.
  const sample = ['omori-1.jpg', 'subnautica-1.jpg', 'god-of-war-1.jpg', 'plants-vs-zombies-goty-edition-1.jpg']
    .map((f) => marked.find((s) => s.file === f))
    .filter(Boolean);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 120000,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-start:not([hidden])', { timeout: 60000 });

  check('Есть что проверять', marked.length > 0, `кадров с разметкой: ${marked.length}`);

  for (const item of sample) {
    const region = item.blur[0];
    const measured = await page.evaluate(
      async (file, r, measureSrc) => {
        const measure = eval(measureSrc);
        const { drawItem, loadImage } = await import('/js/render.js');
        const img = await loadImage(`img/shots/${file}`);

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        // Холст не в документе: clientWidth равен нулю, поэтому размер задаём
        // сами, а drawItem берёт его как есть.
        Object.defineProperty(canvas, 'clientWidth', { value: img.naturalWidth });
        Object.defineProperty(canvas, 'clientHeight', { value: img.naturalHeight });

        drawItem(canvas, img, []);
        const before = measure(canvas, r);
        // Кусок рядом с областью — контроль, что мыло не растеклось.
        const near = { x: Math.min(0.75, r.x), y: r.y > 0.5 ? 0.05 : 0.75, w: 0.2, h: 0.15 };
        const nearBefore = measure(canvas, near);

        drawItem(canvas, img, [r]);
        const after = measure(canvas, r);
        const nearAfter = measure(canvas, near);
        return { before, after, nearBefore, nearAfter };
      },
      item.file,
      region,
      MEASURE,
    );

    const drop = measured.before.edge / Math.max(0.01, measured.after.edge);
    check(
      `${item.file}: надпись скрыта`,
      drop >= MIN_DROP,
      `резкость ${measured.before.edge.toFixed(1)} → ${measured.after.edge.toFixed(1)} (в ${drop.toFixed(1)} раза)`,
    );
    check(
      `${item.file}: это блюр, а не заливка`,
      measured.after.spread >= MIN_SPREAD,
      `разброс цвета ${measured.after.spread.toFixed(1)}`,
    );
    const nearDrop = Math.abs(measured.nearBefore.edge - measured.nearAfter.edge);
    check(
      `${item.file}: соседний кусок кадра не тронут`,
      nearDrop < 0.5,
      `резкость рядом ${measured.nearBefore.edge.toFixed(1)} → ${measured.nearAfter.edge.toFixed(1)}`,
    );
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nПроверок: ${results.length}, провалено: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('[check-blur]', e);
  process.exit(1);
});
