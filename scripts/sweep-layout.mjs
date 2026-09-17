/**
 * Сплошной проход по размерам окна: ищем, где вёрстка начинает вылезать за
 * край. Фиксированных «эталонных» устройств мало — модерация поймала обрезку
 * ровно на том вьюпорте, который никто не проверял. Здесь берётся сетка ширин
 * и высот плюс список реальных телефонов и планшетов, и каждый размер
 * проверяется на всех экранах игры.
 *
 * Проверяется худший случай, и он не один:
 *   - в localStorage подставлен рекорд, из-за которого на стартовом экране
 *     появляется лишняя строка — именно с ней меню переставало влезать во
 *     встроенный вью Яндекса;
 *   - в варианты ответа подставлены самые длинные названия набора. Партия
 *     берёт вопросы вперемешку, и ждать, что самый длинный выпадет сам, нельзя:
 *     на коротких названиях проход был зелёным, а на длинных четвёртый вариант
 *     уходил за край на 44px.
 *
 * Ищем три разных беды, а не одну:
 *   - элемент вышел за кадр (п. 1.10.1);
 *   - элемент вышел за коробку РОДИТЕЛЯ, оставаясь в кадре, — так текст уезжает
 *     под соседний блок, и проверка «всё в кадре» этого не видит в принципе;
 *   - внутри экрана появилась прокрутка (п. 1.10.2). Списки в модальных окнах
 *     крутиться вправе, остальное — нет.
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

/** Ищет вылезшее за кадр, вылезшее за родителя и прокрутку на текущем экране. */
function inspect() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = [];
  // Прокрутка, разрешённая по смыслу: список лидербордов и длинный текст «Об
  // игре» живут в окне и крутятся внутри себя. Запрет п. 1.10.2 — про страницу.
  const okScroll = ['modal__scroll', 'board__list--modal'];
  const label = (n) => {
    if (n.id) return `#${n.id}`;
    const cls = (n.className || '').toString().trim().split(/\s+/)[0];
    return cls ? `.${cls}` : n.tagName.toLowerCase();
  };

  for (const sel of ['#screen-start', '#screen-game', '#screen-over', '#reveal', '#boards', '#credits']) {
    const scr = document.querySelector(`${sel}:not([hidden])`);
    if (!scr) continue;
    for (const n of [scr, ...scr.querySelectorAll('*')]) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;

      // (1) за кадром. Содержимое прокручиваемого блока за кадр по-честному не
      // выходит — оно уезжает внутрь своего скроллера, и getBoundingClientRect
      // показывает его настоящее место, а не видимое. Проверять надо сам
      // скроллер: он в списке и меряется наравне со всеми.
      let scrolled = false;
      for (let a = n.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (/auto|scroll/.test(acs.overflowY) || /auto|scroll/.test(acs.overflowX)) { scrolled = true; break; }
      }
      if (!scrolled && (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1)) {
        out.push(`${label(n)} за кадром`);
      }

      // (2) прокрутка внутри экрана
      if (!okScroll.some((c) => n.classList.contains(c))) {
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
          out.push(`${label(n)} прокрутка +${n.scrollHeight - n.clientHeight}px`);
        }
        if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1) {
          out.push(`${label(n)} гор. прокрутка +${n.scrollWidth - n.clientWidth}px`);
        }
      }

      // (3) за коробку родителя. Абсолютные и фиксированные считаются от другой
      // коробки, а родитель со своим overflow сам решает, что делать с лишним.
      if (cs.position === 'fixed' || cs.position === 'absolute') continue;
      const p = n.parentElement;
      if (!p || p === document.body || p === document.documentElement) continue;
      const pcs = getComputedStyle(p);
      if (pcs.overflowY !== 'visible' || pcs.overflowX !== 'visible') continue;
      const pr = p.getBoundingClientRect();
      const d = Math.max(pr.top - r.top, r.bottom - pr.bottom, pr.left - r.left, r.right - pr.right);
      if (d > 2) out.push(`${label(n)} из ${label(p)} на ${Math.round(d)}px`);
    }
  }

  // (4) картинка схлопнулась. Формально ничего не вылезло, а играть нельзя:
  // угадывать нечего. Ловится только отдельным правилом.
  const photo = document.querySelector('#screen-game:not([hidden]) .photo');
  if (photo) {
    const h = photo.getBoundingClientRect().height;
    if (h < 60) out.push(`картинка сжата до ${Math.round(h)}px`);
  }

  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.push('гориз. прокрутка страницы');
  if (de.scrollHeight > de.clientHeight + 1) out.push('верт. прокрутка страницы');
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

/** Сколько состояний прогоняется — на него делим в итоговой строке. */
const STATES = 7;
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

console.log('· вопрос с самыми длинными названиями…');
await page.setViewport({ width: 800, height: 800, deviceScaleFactor: 1 });
await sleep(200);
// Партия берёт вопросы вперемешку, и ждать, что самый длинный выпадет за
// десяток ходов, нельзя — ставим худший случай руками. Названия берутся из
// самого набора: захардкоженный список отстанет от данных в первый же сбор.
const longest = await page.evaluate(async (n) => {
  const games = await fetch('data/games.json', { cache: 'no-cache' }).then((r) => r.json());
  const list = Array.isArray(games) ? games : games.games;
  return [...list].sort((a, b) => b.name.length - a.name.length).slice(0, n).map((g) => g.name);
}, 4);
console.log(`  худшее название: ${longest[0].length} символов`);
await page.evaluate((names) => {
  // Меняем только подпись: ответ игра сверяет по dataset.gameId, партия цела.
  document.querySelectorAll('#options .option').forEach((b, i) => {
    b.textContent = names[i % names.length];
  });
}, longest);
await sleep(250);
found.push(...(await sweep(page, 'вопрос (длинные названия)', sizes)));

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

console.log(`\n=== ИТОГ: проблемных сочетаний ${found.length} из ${sizes.length * STATES} ===`);
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
