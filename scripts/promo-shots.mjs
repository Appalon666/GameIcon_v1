/**
 * Промо-скриншоты для карточки Яндекс Игр в правильных пропорциях:
 * ПК — 16:9 (1920×1080), мобила — 9:16 (1080×1920).
 *
 * Все четыре кадра — геймплей: вопрос по иконке, вопрос по скриншоту, верный
 * ответ, режим «на время». Кадр меню отсюда убран: модерация завернула промо
 * по п. 5.1.1.2 («геймплей менее 70%») — экран выбора режима геймплеем не
 * считается, да и нижняя половина кадра у него пустая.
 *
 * Нужен запущенный дев-сервер: npm run serve. Запуск: node scripts/promo-shots.mjs
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { ROOT } from './lib.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = `http://localhost:${process.env.PORT || 8080}/`;
const OUT = join(ROOT, 'promo');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1280×720 @1.5 → 1920×1080 (16:9); 432×768 @2.5 → 1080×1920 (9:16).
// Высота ПК-вьюпорта именно 720, а не 540: на 540 срабатывает медиазапрос
// «низкий ландшафт» (раскладка для телефона лёжа), и промо снималось бы не в
// том виде, который увидит игрок за компьютером.
const DEVICES = [
  { name: 'pc', width: 1280, height: 720, dsf: 1.5, mobile: false },
  { name: 'mobile', width: 432, height: 768, dsf: 2.5, mobile: true },
];

/** Ждёт, пока в вопросе появятся варианты и прорисуется картинка. */
async function waitQuestion(page) {
  await page.waitForSelector('#screen-game:not([hidden])', { timeout: 8000 });
  await page.waitForSelector('.option', { timeout: 10000 });
  await page.waitForFunction(() => {
    const c = document.getElementById('canvas');
    return c && c.width > 0 && c.height > 0;
  }, { timeout: 10000 });
  await sleep(700); // доиграть анимацию появления кадра
}

/** Отвечает, пока не выпадет «Верно!», и снимает экран разбора. Возвращает успех. */
async function captureCorrect(page, path) {
  for (let i = 0; i < 20; i++) {
    await page.waitForSelector('.option:not([disabled])', { timeout: 8000 });
    const opts = await page.$$('.option:not([disabled])');
    await opts[0].click();
    await page.waitForSelector('#reveal:not([hidden])', { timeout: 5000 });
    await sleep(250);
    const verdict = await page.$eval('#reveal-verdict', (e) => e.textContent.trim());
    const over = (await page.$eval('#btn-next', (e) => e.textContent.trim())) === 'Итоги';
    if (verdict.startsWith('Верно')) {
      await sleep(350);
      await page.screenshot({ path });
      return true;
    }
    await page.click('#btn-next');
    if (over) {
      await page.waitForSelector('#screen-over:not([hidden])', { timeout: 6000 });
      await page.click('#btn-again');
    }
    await waitQuestion(page).catch(() => {});
  }
  return false;
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

  /** Открывает меню и запускает партию выбранного типа картинок. */
  const startGame = async (kind, mode = '#btn-play') => {
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#screen-start:not([hidden])', { timeout: 20000 });
    if (kind) await page.click(`#kind [data-kind="${kind}"]`);
    await page.click(mode);
    await waitQuestion(page);
  };

  // 1. Вопрос по иконке-ярлыку.
  await startGame('icon');
  await page.screenshot({ path: join(OUT, `${dev.name}-1-icons.png`) });

  // 2. Вопрос по скриншоту + 3. экран верного ответа.
  await startGame('shot');
  await page.screenshot({ path: join(OUT, `${dev.name}-2-shots.png`) });
  await captureCorrect(page, join(OUT, `${dev.name}-3-correct.png`));

  // 4. Режим «на время» — виден таймер.
  await startGame(null, '#btn-play-timed');
  await page.screenshot({ path: join(OUT, `${dev.name}-4-timed.png`) });

  await page.close();
}

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
for (const dev of DEVICES) {
  await run(browser, dev);
  console.log(`✓ ${dev.name}`);
}
await browser.close();
console.log(`Готово → ${OUT}`);
