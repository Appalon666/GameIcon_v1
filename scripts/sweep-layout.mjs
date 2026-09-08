/**
 * Сплошной проход по размерам окна: ищем, где вёрстка начинает вылезать за
 * край. Фиксированных «эталонных» устройств мало — модерация поймала обрезку
 * ровно на том вьюпорте, который никто не проверял. Здесь берётся сетка ширин
 * и высот плюс список реальных телефонов и планшетов, и каждый размер
 * проверяется на всех экранах игры.
 *
 * Проверяется худший случай: в localStorage подставлен рекорд, из-за которого
 * на стартовом экране появляется лишняя строка — именно с ней меню переставало
 * влезать во встроенный вью Яндекса.
 *
 * Быстро работает за счёт того, что страница грузится один раз на состояние, а
 * размеры окна перебираются reflow'ом без перезагрузки.
 *
 * Нужен дев-сервер: npm run serve. Запуск: node scripts/sweep-layout.mjs
 */
import puppeteer from 'puppeteer-core';
import { chromePath } from './lib.mjs';

const CHROME = chromePath();
const URL = `http://localhost:${process.env.PORT || 8080}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Сетка: покрывает всё от узкого телефона до широкого монитора. */
const WIDTHS = [320, 360, 375, 390, 412, 430, 480, 540, 600, 667, 720, 768, 820, 900, 1000, 1100, 1280, 1440, 1920];
const HEIGHTS = [320, 360, 400, 430, 500, 560, 600, 630, 660, 700, 740, 800, 900, 1024, 1080];

/** Реальные устройства — их проверяем отдельно и называем по имени. */
const DEVICES = [
  ['iPhone SE', 375, 667], ['iPhone SE лёжа', 667, 375],
  ['iPhone 12/13/14', 390, 844], ['iPhone 12/13/14 лёжа', 844, 390],
  ['iPhone 15 Plus', 430, 932], ['iPhone 15 Plus лёжа', 932, 430],
  ['Galaxy S8', 360, 740], ['Galaxy S8 лёжа', 740, 360],
  ['Galaxy A26', 411, 891], ['Galaxy A26 лёжа', 891, 411],
  ['Pixel 7', 412, 915], ['Pixel 7 лёжа', 915, 412],
  ['iPad mini', 744, 1133], ['iPad mini лёжа', 1133, 744],
  ['iPad', 810, 1080], ['iPad лёжа', 1080, 810],
  ['встроенный вью', 1000, 630], ['встроенный вью узкий', 860, 600],
  ['ноутбук', 1366, 768], ['монитор', 2560, 1440],
];

/** Ищет вылезшие за край элементы и прокрутку на текущем экране. */
function inspect() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = [];
  for (const sel of ['#screen-start', '#screen-game', '#screen-over', '#reveal', '#boards', '#credits']) {
    const scr = document.querySelector(`${sel}:not([hidden])`);
    if (!scr) continue;
    for (const n of scr.querySelectorAll('button, .option, .photo, .timer, .hud, .title, .modal__box, .board__list, .picker, .records, .result')) {
      if (n.offsetParent === null && getComputedStyle(n).position !== 'fixed') continue;
      const r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
        out.push(`${sel.slice(1)}>${n.id || (n.className || '').toString().split(' ')[0]}`);
      }
    }
  }
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.push('гориз. прокрутка');
  if (de.scrollHeight > de.clientHeight + 1) out.push('верт. прокрутка');
  // Дубли элементов в отчёте не нужны — важен сам факт.
  return [...new Set(out)];
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});

/** Прогоняет все размеры на текущем состоянии страницы. */
async function sweep(page, stateName, sizes) {
  const bad = [];
  for (const [label, w, h] of sizes) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    // Канвас перерисовывается с задержкой 150мс — ждём чуть больше.
    await sleep(190);
    const issues = await page.evaluate(inspect);
    if (issues.length) bad.push({ state: stateName, label, w, h, issues });
  }
  return bad;
}

const page = await browser.newPage();
await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'domcontentloaded' });
// Худший случай: у игрока есть рекорд, на стартовом экране лишняя строка.
await page.evaluate(() =>
  localStorage.setItem('best', JSON.stringify({ total: 123456, icons: 9999, shots: 8888, timetotal: 7777, hardcore: 6666 })),
);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#screen-start:not([hidden])', { timeout: 40000 });

const grid = [];
for (const w of WIDTHS) for (const h of HEIGHTS) grid.push([`${w}x${h}`, w, h]);
const named = DEVICES.map(([n, w, h]) => [n, w, h]);
const sizes = [...named, ...grid];
console.log(`Размеров: ${sizes.length} (${named.length} названных устройств + сетка ${WIDTHS.length}x${HEIGHTS.length})`);

const found = [];

console.log('· меню (с рекордом)…');
found.push(...(await sweep(page, 'меню', sizes)));

console.log('· лидерборды…');
await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });
await page.click('#btn-board');
await sleep(400);
found.push(...(await sweep(page, 'лидерборды', sizes)));
await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });
await sleep(200);
await page.click('#btn-boards-close');

console.log('· об игре…');
await page.click('#btn-credits');
await sleep(300);
found.push(...(await sweep(page, 'об игре', sizes)));
await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });
await sleep(200);
await page.click('#btn-credits-close');

console.log('· вопрос…');
await page.click('#btn-play');
await page.waitForSelector('#screen-game:not([hidden]) .option', { timeout: 20000 });
await sleep(600);
found.push(...(await sweep(page, 'вопрос', sizes)));

console.log('· разбор ответа…');
await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });
await sleep(300);
await page.click('#options .option');
await page.waitForSelector('#reveal:not([hidden])', { timeout: 8000 });
await sleep(400);
found.push(...(await sweep(page, 'разбор', sizes)));

console.log('· итоги партии…');
await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });
await sleep(300);
await page.click('#btn-next').catch(() => {});
// Доигрываем до конца: в хардкоре хватило бы одной ошибки, но мы в обычном —
// жмём заведомо неверные варианты, пока не кончатся жизни.
for (let i = 0; i < 12; i++) {
  if (await page.$('#screen-over:not([hidden])')) break;
  await page.waitForSelector('#options .option:not([disabled])', { timeout: 10000 }).catch(() => {});
  const opts = await page.$$('#options .option:not([disabled])');
  if (!opts.length) break;
  await opts[opts.length - 1].click();
  await page.waitForSelector('#reveal:not([hidden])', { timeout: 8000 }).catch(() => {});
  await sleep(150);
  await page.click('#btn-next').catch(() => {});
  await sleep(250);
}
if (await page.$('#screen-over:not([hidden])')) {
  found.push(...(await sweep(page, 'итоги', sizes)));
} else {
  console.log('  (до экрана итогов дойти не удалось — пропускаем)');
}

await browser.close();

console.log(`\n=== ИТОГ: проблемных сочетаний ${found.length} из ${sizes.length * 6} ===`);
if (!found.length) {
  console.log('Ни на одном размере ничего не вылезает.');
} else {
  const byState = new Map();
  for (const f of found) {
    const k = `${f.state} :: ${f.issues.join(', ')}`;
    if (!byState.has(k)) byState.set(k, []);
    byState.get(k).push(`${f.label} (${f.w}x${f.h})`);
  }
  for (const [k, list] of [...byState.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${k}`);
    console.log(`  размеров: ${list.length}`);
    console.log(`  ${list.slice(0, 14).join(', ')}${list.length > 14 ? ` … и ещё ${list.length - 14}` : ''}`);
  }
}
process.exit(found.length ? 1 : 0);
