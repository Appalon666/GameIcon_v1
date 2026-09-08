/**
 * Проверка звука на живой игре.
 *
 * Музыка появилась в игре последней, а требований к ней сразу три, и все
 * проверяются только в браузере:
 *   п. 1.3 — скрытая вкладка обязана глушить звук;
 *   п. 4.7 — полноэкранная реклама тоже (шаг про рекламу — в check-ads.mjs,
 *            здесь проверяется общий механизм паузы, на котором он стоит);
 *   автозапуск — браузер не даёт звуку начаться до жеста игрока, и игра не
 *            должна делать вид, что музыка играет.
 *
 * Отдельно проверяется то, на чём обжёгся соседний проект: **выбор игрока не
 * теряется паузой**. Там пауза запоминала уже выставленную тишину и оставляла
 * игру немой навсегда.
 *
 * Браузер поднимается с `--autoplay-policy=no-user-gesture-required`, иначе в
 * headless звук не стартует вовсе и проверка мерила бы запрет, а не игру.
 *
 * Нужен дев-сервер: npm run serve. Запуск: node scripts/check-audio.mjs
 */
import puppeteer from 'puppeteer-core';
import { chromePath } from './lib.mjs';

const CHROME = chromePath();
const URL = `http://localhost:${process.env.PORT || 8080}/`;
/** Затухание в audio.js — 0.35 с; ждём с запасом. */
const FADE_WAIT = 700;

const results = [];
const check = (item, ok, detail) => {
  results.push({ item, ok, detail });
  console.log(`${ok ? '[ ОК ]' : '[ПРОВАЛ]'} ${item}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 120000,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // Без этого headless не даёт звуку начаться, и все шаги мерили бы
      // политику автозапуска вместо поведения игры.
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-start:not([hidden])', { timeout: 60000 });

  /** Состояние музыки: { muted, paused, started, ctx, gain }. */
  const state = () => page.evaluate(`import('/js/audio.js').then((m) => m.music.state)`);
  /** Слышно ли на самом деле: контекст идёт и громкость поднята. */
  const audible = (st) => st.ctx === 'running' && st.gain > 0.01;

  const before = await state();
  check('До жеста игрока музыка не играет', !before.started && !audible(before),
    `started=${before.started}, контекст ${before.ctx}`);

  // Файл на месте и отдаётся с правильным типом — иначе decodeAudioData
  // молча уронит музыку, а игра этого не заметит.
  const head = await page.evaluate(async () => {
    const r = await fetch('audio/theme.mp3');
    const buf = await r.arrayBuffer();
    return { ok: r.ok, type: r.headers.get('content-type'), len: buf.byteLength };
  });
  check('Трек отдаётся как audio/mpeg', head.ok && /audio\/mpeg/.test(head.type ?? ''),
    `${head.type}, ${Math.round(head.len / 1024)} КБ`);

  // Жест игрока — музыка обязана подняться.
  await page.click('body');
  await sleep(FADE_WAIT + 800);
  const afterClick = await state();
  check('После жеста игрока музыка играет', audible(afterClick),
    `контекст ${afterClick.ctx}, громкость ${afterClick.gain.toFixed(2)}`);

  // Кнопка звука.
  await page.click('#btn-sound-menu');
  await sleep(FADE_WAIT + 200);
  const offState = await state();
  check('Кнопка выключает звук', offState.muted && !audible(offState),
    `контекст ${offState.ctx}, громкость ${offState.gain.toFixed(2)}`);

  const iconOff = await page.evaluate(() =>
    document.getElementById('btn-sound-menu').getAttribute('aria-pressed'));
  check('Кнопка сообщает состояние в разметке', iconOff === 'true', `aria-pressed=${iconOff}`);

  // Пауза при выключенном звуке не должна ничего «запомнить».
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(FADE_WAIT);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(FADE_WAIT + 300);
  const afterPauseMuted = await state();
  check('Выбор игрока переживает паузу', afterPauseMuted.muted && !audible(afterPauseMuted),
    afterPauseMuted.muted ? 'звук остался выключенным' : 'пауза сбросила выбор игрока');

  // Обратно включаем.
  await page.click('#btn-sound-menu');
  await sleep(FADE_WAIT + 300);
  const onAgain = await state();
  check('Кнопка включает звук обратно', !onAgain.muted && audible(onAgain),
    `громкость ${onAgain.gain.toFixed(2)}`);

  // п. 1.3 — скрытая вкладка глушит звук.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(FADE_WAIT + 300);
  const hidden = await state();
  check('п. 1.3 — скрытая вкладка глушит звук', hidden.paused && !audible(hidden),
    `контекст ${hidden.ctx}, громкость ${hidden.gain.toFixed(2)}`);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(FADE_WAIT + 300);
  const back = await state();
  check('Возврат на вкладку возвращает звук', !back.paused && audible(back),
    `громкость ${back.gain.toFixed(2)}`);

  // Выбор игрока переживает перезагрузку.
  await page.click('#btn-sound-menu');
  await sleep(200);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-start:not([hidden])', { timeout: 60000 });
  await page.click('body');
  await sleep(FADE_WAIT + 500);
  const afterReload = await state();
  check('Выключенный звук переживает перезагрузку', afterReload.muted && !audible(afterReload),
    afterReload.muted ? 'запомнено' : 'музыка заиграла снова');

  await browser.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nПроверок: ${results.length}, провалено: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('[check-audio]', e);
  process.exit(1);
});
