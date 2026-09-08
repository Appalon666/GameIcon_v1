/**
 * Снимает скриншоты игры в headless-Chrome и проверяет адаптив: нет ли
 * горизонтальной прокрутки и не уезжают ли ключевые кнопки за край экрана
 * (эта беда была в родительском проекте на мобиле/в ландшафте).
 *
 * Нужен запущенный дев-сервер: npm run serve. Запуск: npm run shots-ui
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { ROOT, chromePath } from './lib.mjs';

const CHROME = chromePath();
const URL = `http://localhost:${process.env.PORT || 8080}/`;
const OUT = join(ROOT, 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEVICES = [
  { name: 'pc', width: 1280, height: 800, dsf: 1, mobile: false },
  { name: 'pc-embed', width: 1000, height: 630, dsf: 1, mobile: false },
  { name: 'mobile', width: 390, height: 844, dsf: 2, mobile: true },
  { name: 'mobile-landscape', width: 844, height: 390, dsf: 2, mobile: true },
  // Ровно та геометрия, на которой модерация Яндекса поймала обрезку (п. 1.10.1).
  { name: 'android-landscape', width: 915, height: 412, dsf: 2, mobile: true },
];

/** Проверка адаптива на текущем экране страницы. */
async function audit(page, label) {
  return page.evaluate((lbl) => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth > de.clientWidth + 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Всё, что игрок видит и трогает: и меню, и игровой экран. Обрезка любого
    // из этих элементов — нарушение п. 1.10.1 (именно на вариантах ответа в
    // ландшафте нас и завернули).
    const targets = [
      ...['btn-play', 'btn-play-timed', 'btn-play-hard', 'btn-board', 'btn-credits']
        .map((id) => [id, document.getElementById(id)]),
      ...[...document.querySelectorAll('#options .option')].map((n, i) => [`option-${i + 1}`, n]),
      ...['btn-home', 'btn-hint', 'btn-next', 'btn-again'].map((id) => [id, document.getElementById(id)]),
      ['photo', document.querySelector('#screen-game:not([hidden]) .photo')],
      ['timer', document.querySelector('#timer:not([hidden])')],
    ];
    const offscreen = [];
    for (const [name, elx] of targets) {
      if (!elx || elx.offsetParent === null) continue;
      const r = elx.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
        offscreen.push(`${name} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)}x${Math.round(r.bottom)}]`);
      }
    }
    return { label: lbl, overflowX, scrollW: de.scrollWidth, clientW: de.clientWidth, vw, vh, offscreen };
  }, label);
}

async function run(browser, dev) {
  const page = await browser.newPage();
  await page.setViewport({
    width: dev.width,
    height: dev.height,
    deviceScaleFactor: dev.dsf,
    isMobile: dev.mobile,
    hasTouch: dev.mobile,
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-start:not([hidden])', { timeout: 20000 });
  await sleep(500);

  const reports = [];
  await page.screenshot({ path: join(OUT, `${dev.name}-menu.png`) });
  reports.push(await audit(page, `${dev.name}: меню`));

  // Игра: режим иконок, обычный.
  await page.click('#kind [data-kind="icon"]').catch(() => {});
  await page.click('#btn-play');
  await page.waitForSelector('#screen-game:not([hidden]) .option', { timeout: 15000 });
  await sleep(1200);
  await page.screenshot({ path: join(OUT, `${dev.name}-game.png`) });
  reports.push(await audit(page, `${dev.name}: игра`));

  // Разбор ответа — кликаем первый вариант.
  await page.click('#options .option').catch(() => {});
  await sleep(700);
  await page.screenshot({ path: join(OUT, `${dev.name}-reveal.png`) });
  reports.push(await audit(page, `${dev.name}: разбор`));

  await page.close();
  return reports;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const all = [];
  for (const dev of DEVICES) {
    try {
      all.push(...(await run(browser, dev)));
    } catch (e) {
      console.error(`[shots] ${dev.name}: ${e.message}`);
    }
  }
  await browser.close();

  console.log('\n=== Адаптив ===');
  let problems = 0;
  for (const r of all) {
    const bad = r.overflowX || r.offscreen.length;
    if (bad) problems++;
    console.log(
      `${bad ? '⚠️ ' : '✓ '}${r.label.padEnd(22)} vp ${r.vw}x${r.vh}` +
        (r.overflowX ? ` | H-SCROLL ${r.scrollW}>${r.clientW}` : '') +
        (r.offscreen.length ? ` | за краем: ${r.offscreen.join(', ')}` : ''),
    );
  }
  console.log(`\n[shots] скриншоты в screenshots/, проблем адаптива: ${problems}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
