/**
 * Проверка рекламного контракта на живой игре.
 *
 * Ловит ровно то, за что снимают с публикации и что нельзя проверить «на глаз»:
 * колбэк, который не пришёл. Заглушка SDK умеет молчать, открывать ролик и не
 * закрывать его, закрывать без награды — то есть выдавать все исходы, которых
 * от реальной площадки по заказу не дождёшься.
 *
 * Что проверяется:
 *   п. 4.7  — игра не продолжается ПОД идущей рекламой: пока не пришёл onClose,
 *             показ не считается законченным (сторож «не открылась» снимается
 *             в onOpen);
 *   п. 1.14 — но и вечной паузы нет: молчащий SDK развязывается сторожем;
 *   п. 4.5  — награда только по onRewarded, закрытый раньше ролик её не даёт;
 *   критическая секция — второй показ поверх первого не начинается.
 *
 * Игра открывается ВНУТРИ iframe: вне его sdk.js рекламу не зовёт вовсе (там
 * колбэки не приходят), и проверять было бы нечего.
 *
 * Нужен дев-сервер: npm run serve. Запуск: node scripts/check-ads.mjs
 */
import puppeteer from 'puppeteer-core';
import { chromePath } from './lib.mjs';

const CHROME = chromePath();
const PORT = process.env.PORT || 8080;
const ORIGIN = `http://localhost:${PORT}`;
/** Сторожа в sdk.js: «не открылась» 15 с, «не закрылась» 180 с. */
const OPEN_GUARD_MS = 15_000;

const results = [];
const check = (item, ok, detail) => {
  results.push({ item, ok, detail });
  console.log(`${ok ? '[ ОК ]' : '[ПРОВАЛ]'} ${item}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Заглушка SDK вместо /sdk.js. Поведение рекламы задаётся через window.__ad.mode:
 *   silent        — не приходит ни один колбэк (SDK промолчал);
 *   openStuck     — ролик открылся и не закрылся;
 *   closeNoReward — открылся и закрылся, награды не было;
 *   rewarded      — открылся, наградил, закрылся.
 */
const STUB = `
window.__ad = { mode: 'rewarded', shows: 0, opens: 0, gameplay: [], ready: false, last: null };
/** Отпускает застрявший открытым ролик: онClose из теста, а не по таймеру. */
window.__ad.release = () => { window.__ad.last?.onClose?.(); };
const fire = (cb, mode) => {
  window.__ad.last = cb;
  if (mode === 'silent') return;
  cb.onOpen?.();
  window.__ad.opens++;
  if (mode === 'openStuck') return;
  setTimeout(() => {
    if (mode === 'rewarded') cb.onRewarded?.();
    cb.onClose?.();
  }, 200);
};
window.YaGames = {
  init: () => Promise.resolve({
    environment: { i18n: { lang: 'ru' } },
    on: () => {},
    features: {
      LoadingAPI: { ready: () => { window.__ad.ready = true; } },
      GameplayAPI: {
        start: () => window.__ad.gameplay.push('start'),
        stop: () => window.__ad.gameplay.push('stop'),
      },
    },
    getPlayer: () => Promise.resolve({
      getMode: () => 'lite',
      getData: () => Promise.resolve({}),
      setData: () => Promise.resolve(),
      getUniqueID: () => 'stub',
    }),
    leaderboards: {
      setScore: () => Promise.resolve(),
      getEntries: () => Promise.resolve({ entries: [] }),
    },
    adv: {
      showFullscreenAdv: ({ callbacks }) => { window.__ad.shows++; fire(callbacks, window.__ad.mode); },
      showRewardedVideo: ({ callbacks }) => { window.__ad.shows++; fire(callbacks, window.__ad.mode); },
    },
  }),
};
`;

/** Страница-обёртка: игра внутри iframe, как на площадке. */
const HOST = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
<iframe src="${ORIGIN}/"></iframe>`;

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url === `${ORIGIN}/__host`) {
      return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: HOST });
    }
    if (url === `${ORIGIN}/sdk.js`) {
      return req.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', body: STUB });
    }
    return req.continue();
  });

  await page.goto(`${ORIGIN}/__host`, { waitUntil: 'domcontentloaded' });
  const frame = await page.waitForFrame(
    (f) => f.url().startsWith(`${ORIGIN}/`) && !f.url().includes('__host'),
  );
  await frame.waitForSelector('#screen-start:not([hidden])', { timeout: 60000 });

  check(
    'SDK-заглушка подхвачена, игра загрузилась',
    await frame.evaluate(() => window.__ad?.ready === true),
    'LoadingAPI.ready() вызван',
  );

  /** Зовёт метод sdk.js напрямую — модуль тот же, что уже работает в игре. */
  const sdkCall = (code) => frame.evaluate(`import('/js/sdk.js').then((m) => (${code}))`);
  const setMode = (mode) => frame.evaluate((m) => {
    window.__ad.mode = m;
    window.__ad.shows = 0;
    window.__ad.opens = 0;
  }, mode);

  // п. 4.5 — награда только по onRewarded.
  await setMode('rewarded');
  check('п. 4.5 — досмотренный ролик даёт награду', (await sdkCall('m.sdk.showRewarded()')) === true);

  await setMode('closeNoReward');
  check(
    'п. 4.5 — закрытый без onRewarded ролик награды не даёт',
    (await sdkCall('m.sdk.showRewarded()')) === false,
  );

  // Критическая секция: второй показ поверх первого не начинается.
  await setMode('rewarded');
  const pair = await sdkCall('Promise.all([m.sdk.showRewarded(), m.sdk.showRewarded()])');
  check(
    'Показ рекламы — критическая секция на одного',
    pair[0] === true && pair[1] === false,
    `первый ${pair[0]}, второй ${pair[1]}`,
  );

  // п. 4.7 — пока ролик на экране, показ не считается законченным.
  await setMode('openStuck');
  // Хвост 'started' обязателен: значение последнего выражения скрипта уходит
  // в puppeteer, и промис показа он бы ДОЖДАЛСЯ — а нам надо как раз смотреть
  // со стороны, закончился показ или нет.
  await frame.evaluate(`window.__stuck = { done: false };
    import('/js/sdk.js').then((m) => m.sdk.showInterstitial()).then(() => { window.__stuck.done = true; });
    'started';`);
  await new Promise((r) => setTimeout(r, OPEN_GUARD_MS + 3000));
  const stuck = await frame.evaluate(() => ({
    done: window.__stuck.done,
    shows: window.__ad.shows,
    opens: window.__ad.opens,
  }));
  check(
    'п. 4.7 — игра не продолжается под открытой рекламой',
    !stuck.done && stuck.opens === 1,
    stuck.done
      ? `показ развязан через ${OPEN_GUARD_MS / 1000} с, хотя ролик ещё на экране`
      : `ждём onClose, а не таймер (показов ${stuck.shows}, открытий ${stuck.opens})`,
  );

  // Отпускаем застрявший ролик: показ обязан закончиться сразу по onClose,
  // а критическая секция — освободиться, иначе следующие проверки получат отказ.
  await frame.evaluate(() => { window.__ad.release(); });
  const released = await frame
    .waitForFunction(() => window.__stuck.done, { timeout: 5000, polling: 100 })
    .then(() => true)
    .catch(() => false);
  check('onClose заканчивает показ и освобождает секцию', released,
    released ? 'развязка пришла по колбэку' : 'после onClose показ не закончился');

  // п. 1.14 — но молчащий SDK всё же развязывается: вечной паузы нет.
  await setMode('silent');
  const silentStart = Date.now();
  await frame.evaluate(`window.__silent = { done: false };
    import('/js/sdk.js').then((m) => m.sdk.showRewarded()).then((v) => { window.__silent = { done: true, v }; });
    'started';`);
  await frame.waitForFunction(() => window.__silent.done, {
    timeout: OPEN_GUARD_MS + 10000,
    polling: 500,
  });
  const silent = await frame.evaluate(() => window.__silent);
  check(
    'п. 1.14 — молчащий SDK не оставляет игру на паузе навсегда',
    silent.done && silent.v === false,
    `развязано за ${((Date.now() - silentStart) / 1000).toFixed(1)} с, награды нет`,
  );

  // Живой сценарий: подсказка 50/50 за ролик, который игрок не досмотрел.
  await setMode('closeNoReward');
  await frame.click('#btn-play');
  await frame.waitForSelector('#options .option:not([disabled])', { timeout: 60000 });
  await frame.click('#btn-hint');
  await frame.waitForFunction(() => !document.getElementById('status').hidden, { timeout: 30000 });
  const afterFail = await frame.evaluate(() => ({
    status: document.getElementById('status').textContent,
    hidden: document.querySelectorAll('.option--hidden').length,
  }));
  check(
    'Отказ от просмотра объяснён игроку, подсказка не выдана',
    afterFail.hidden === 0 && /не досмотрен/i.test(afterFail.status),
    `«${afterFail.status}», убрано вариантов: ${afterFail.hidden}`,
  );

  await setMode('rewarded');
  await frame.click('#btn-hint');
  const fiftyWorked = await frame
    .waitForFunction(() => document.querySelectorAll('.option--hidden').length === 2, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check('Досмотренный ролик убирает два неверных варианта', fiftyWorked,
    fiftyWorked ? '50/50 сработала' : 'варианты не убрались');

  // п. 4.7 — под рекламой должно быть не только «без геймплея», но и тихо.
  // Ролик здесь открывается и не закрывается, так что состояние ловится прямо
  // во время показа.
  // Подсказку на текущем вопросе уже брали — переходим к следующему, иначе
  // onHint выйдет по hintUsed и рекламы не будет вовсе.
  await frame.click('#options .option:not([disabled])');
  await frame.waitForSelector('#reveal:not([hidden])', { timeout: 30000 });
  await frame.click('#btn-next');
  await frame.waitForSelector('#options .option:not([disabled])', { timeout: 60000 });

  await frame.evaluate(() => { window.__ad.mode = 'openStuck'; });
  await frame.click('#btn-hint');
  await new Promise((r) => setTimeout(r, 1500));
  const underAd = await frame.evaluate(`import('/js/audio.js').then((m) => m.music.state)`);
  check('п. 4.7 — под рекламой музыка молчит',
    underAd.paused && !(underAd.ctx === 'running' && underAd.gain > 0.01),
    `пауза=${underAd.paused}, контекст ${underAd.ctx}, громкость ${underAd.gain.toFixed(2)}`);
  await frame.evaluate(() => { window.__ad.release(); });
  await new Promise((r) => setTimeout(r, 800));

  // GameplayAPI ждёт парных вызовов: два `start` подряд или два `stop` — это
  // рассинхрон, из-за которого площадка либо считает, что игры нет (и вправе
  // показать свою рекламу поверх), либо что она идёт под нашей паузой.
  const gp = await frame.evaluate(() => window.__ad.gameplay);
  const doubled = gp.filter((v, i) => i && v === gp[i - 1]);
  check('GameplayAPI: start и stop идут парами', doubled.length === 0,
    `${gp.length} вызовов: ${gp.join(' → ')}`);

  await browser.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nПроверок: ${results.length}, провалено: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('[check-ads]', e);
  process.exit(1);
});
