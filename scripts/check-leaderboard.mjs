/**
 * Проверка контракта лидербордов на живой игре.
 *
 * Ловит то, что на площадке видно только постфактум и только чужими глазами:
 * результат игрока в таблице ухудшился после слабой партии. Площадка не хранит
 * максимум сама — `setScore` перезаписывает строку игрока ЛЮБЫМ присланным
 * числом, в том числе меньшим. Значит, сравнивать обязана игра.
 *
 * Что проверяется:
 *   - первый результат попадает в таблицу (строки игрока ещё нет);
 *   - лучший результат её обновляет;
 *   - худший и равный до площадки не доходят вовсе;
 *   - гость (getMode() === 'lite') не отправляет ничего;
 *   - если строку не прочитать (сбой сети), сравниваем с личным рекордом;
 *   - две партии подряд: слабая не затирает сильную;
 *   - если не прочитать **облачные рекорды**, не пишем ни в облако, ни в
 *     таблицу: `setData` кладёт объект целиком, и запись поверх непрочитанного
 *     стирает рекорды остальных таблиц.
 *
 * Заглушка SDK ведёт себя как площадка: перезаписывает без вопросов и умеет
 * отвечать «игрока в таблице нет» и «сеть отвалилась» — исходов, которых от
 * живого Яндекса по заказу не дождёшься.
 *
 * Нужен дев-сервер: npm run serve. Запуск: node scripts/check-leaderboard.mjs
 */
import puppeteer from 'puppeteer-core';
import { chromePath } from './lib.mjs';

const CHROME = chromePath();
const PORT = process.env.PORT || 8080;
const ORIGIN = `http://localhost:${PORT}`;

const results = [];
const check = (item, ok, detail) => {
  results.push({ item, ok, detail });
  console.log(`${ok ? '[ ОК ]' : '[ПРОВАЛ]'} ${item}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Заглушка SDK вместо /sdk.js. Поведение задаётся через window.__lb:
 *   entries    — строка игрока по таблицам: имя таблицы → результат;
 *   calls      — всё, что реально дошло до setScore (сюда и смотрим);
 *   mode       — 'logged-in' | 'lite', режим игрока;
 *   entryFail  — 'network', чтобы getPlayerEntry падал не «нет строки», а сбоем.
 */
const STUB = `
window.__lb = {
  entries: {}, calls: [], mode: 'logged-in', entryFail: null, data: {}, dataCalls: [], ready: false,
  // Флаг переживает перезагрузку: сбой getData надо задать ДО старта игры,
  // иначе модуль успеет прочитать рекорды и запомнить их.
  dataFail: sessionStorage.getItem('__lb_dataFail') === '1',
};
const lb = window.__lb;
/** Площадка не знает про «лучший результат»: пишет ровно то, что прислали. */
const setScore = (name, score) => {
  lb.calls.push({ name, score });
  lb.entries[name] = score;
  return Promise.resolve();
};
const getPlayerEntry = (name) => {
  if (lb.entryFail === 'network') return Promise.reject(new Error('сеть недоступна'));
  if (!(name in lb.entries)) {
    const e = new Error('LEADERBOARD_PLAYER_NOT_PRESENT');
    e.code = 'LEADERBOARD_PLAYER_NOT_PRESENT';
    return Promise.reject(e);
  }
  return Promise.resolve({ score: lb.entries[name], rank: 1, player: { uniqueID: 'stub' } });
};
window.YaGames = {
  init: () => Promise.resolve({
    environment: { i18n: { lang: 'ru' } },
    on: () => {},
    features: {
      LoadingAPI: { ready: () => { lb.ready = true; } },
      GameplayAPI: { start: () => {}, stop: () => {} },
    },
    getPlayer: () => Promise.resolve({
      getMode: () => lb.mode,
      getData: () => (lb.dataFail
        ? Promise.reject(new Error('сеть недоступна'))
        : Promise.resolve({ ...lb.data })),
      setData: (data) => { lb.dataCalls.push(data); Object.assign(lb.data, data); return Promise.resolve(); },
      getUniqueID: () => 'stub',
    }),
    leaderboards: {
      setScore,
      getPlayerEntry,
      getEntries: () => Promise.resolve({ entries: [] }),
    },
    adv: {
      showFullscreenAdv: ({ callbacks }) => { callbacks.onOpen?.(); callbacks.onClose?.(); },
      showRewardedVideo: ({ callbacks }) => { callbacks.onClose?.(); },
    },
  }),
};
`;

/** Страница-обёртка: игра внутри iframe, как на площадке. */
const HOST = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
<iframe src="${ORIGIN}/"></iframe>`;

/** Технические имена таблиц из sdk.js — по ним смотрим, что дошло до площадки. */
const NAME = {
  total: 'leadtotal',
  icons: 'leadicons',
  shots: 'leadshots',
  timed: 'leadtimetotal',
};

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    protocolTimeout: 120000,
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
    await frame.evaluate(() => window.__lb?.ready === true),
    'LoadingAPI.ready() вызван',
  );

  /** Зовёт метод sdk.js напрямую — модуль тот же, что уже работает в игре. */
  const sdkCall = (code) => frame.evaluate(`import('/js/sdk.js').then((m) => (${code}))`);
  /** Что лежит в таблице и что до неё дошло. */
  const state = (name) =>
    frame.evaluate(
      (n) => ({
        entry: window.__lb.entries[n] ?? null,
        sent: window.__lb.calls.filter((c) => c.name === n).map((c) => c.score),
      }),
      name,
    );

  // Каждый сценарий берёт свою таблицу: строки игрока в них независимы, поэтому
  // проверки не мешают друг другу.

  // --- total: строки нет → появилась → лучше → хуже → столько же.
  await sdkCall(`m.sdk.submitScore('total', 15000)`);
  let s = await state(NAME.total);
  check('Первый результат попадает в таблицу', s.entry === 15000, `в таблице ${s.entry}`);

  await sdkCall(`m.sdk.submitScore('total', 21000)`);
  s = await state(NAME.total);
  check('Лучший результат обновляет строку', s.entry === 21000, `в таблице ${s.entry}`);

  await sdkCall(`m.sdk.submitScore('total', 300)`);
  s = await state(NAME.total);
  check(
    'Худший результат НЕ затирает рекорд',
    s.entry === 21000,
    s.entry === 21000 ? 'до площадки не дошёл' : `рекорд 21000 стал ${s.entry}`,
  );

  await sdkCall(`m.sdk.submitScore('total', 21000)`);
  s = await state(NAME.total);
  check('Равный результат не шлётся зря', s.sent.length === 2, `отправок: ${s.sent.join(', ')}`);

  // --- Гость: площадка результаты от него не принимает вовсе.
  await frame.evaluate(() => {
    window.__lb.mode = 'lite';
  });
  await sdkCall(`m.sdk.submitScore('icons', 5000)`);
  s = await state(NAME.icons);
  check('Гость без аккаунта ничего не отправляет', s.sent.length === 0, `отправок: ${s.sent.length}`);
  await frame.evaluate(() => {
    window.__lb.mode = 'logged-in';
  });

  // --- Строку не прочитать: сравниваем с личным рекордом, который знаем сами.
  await frame.evaluate(() => {
    window.__lb.entries.leadshots = 9000;
    window.__lb.entryFail = 'network';
  });
  await sdkCall(`m.sdk.submitScore('shots', 400, 9000)`);
  s = await state(NAME.shots);
  check(
    'Сбой чтения строки: худший результат всё равно не шлётся',
    s.sent.length === 0,
    s.sent.length === 0 ? 'сравнили с личным рекордом' : `ушло ${s.sent.join(', ')}`,
  );

  await sdkCall(`m.sdk.submitScore('shots', 12000, 9000)`);
  s = await state(NAME.shots);
  check('Сбой чтения строки: лучший результат доходит', s.entry === 12000, `в таблице ${s.entry}`);
  await frame.evaluate(() => {
    window.__lb.entryFail = null;
  });

  // --- Живой сценарий: две партии подряд тем же путём, каким ходит игра.
  const first = await sdkCall(`m.sdk.recordResult('timed', 15000)`);
  const second = await sdkCall(`m.sdk.recordResult('timed', 300)`);
  s = await state(NAME.timed);
  const best = await sdkCall(`m.sdk.loadBest()`);
  check(
    'Две партии: слабая не затирает сильную',
    s.entry === 15000,
    s.entry === 15000 ? 'в таблице остались 15000' : `в таблице ${s.entry}`,
  );
  check('Личный рекорд после слабой партии не сбросился', best.timed === 15000, `рекорд ${best.timed}`);
  check(
    '«Новый рекорд» показывается только за рекорд',
    first === true && second === false,
    `первая партия ${first}, вторая ${second}`,
  );

  // --- Облачные рекорды не читаются: сбой не даёт права на запись.
  // Нужна чистая загрузка: рекорды читаются один раз за сессию и кэшируются,
  // а до этого места модуль их уже прочитал.
  await frame.evaluate(() => sessionStorage.setItem('__lb_dataFail', '1'));
  await page.goto(`${ORIGIN}/__host`, { waitUntil: 'domcontentloaded' });
  const frame2 = await page.waitForFrame(
    (f) => f.url().startsWith(`${ORIGIN}/`) && !f.url().includes('__host'),
  );
  await frame2.waitForSelector('#screen-start:not([hidden])', { timeout: 60000 });
  const call2 = (code) => frame2.evaluate(`import('/js/sdk.js').then((m) => (${code}))`);

  const saved = await call2(`m.sdk.saveBest('total', 5000)`);
  const writes = await frame2.evaluate(() => window.__lb.dataCalls.length);
  check(
    'Рекорды не прочитались: облако не переписываем',
    saved === false && writes === 0,
    writes === 0 ? 'setData не звался' : `в облако ушло ${writes} записей`,
  );

  await frame2.evaluate(() => {
    window.__lb.entryFail = 'network';
  });
  await call2(`m.sdk.recordResult('icons', 300)`);
  const blind = await frame2.evaluate(() => window.__lb.calls.length);
  check(
    'Ни рекордов, ни строки: в таблицу не шлём вслепую',
    blind === 0,
    blind === 0 ? 'сравнить было не с чем' : `ушло ${blind} отправок`,
  );

  // Обратная сторона: строку прочитать удалось — отправка обязана пройти,
  // иначе правка превратилась бы в «не шлём никогда».
  await frame2.evaluate(() => {
    window.__lb.entryFail = null;
    window.__lb.entries.leadshots = 100;
  });
  await call2(`m.sdk.recordResult('shots', 5000)`);
  const live = await frame2.evaluate(() => window.__lb.entries.leadshots);
  check(
    'Рекорды не прочитались, но строка есть: сильный результат доходит',
    live === 5000,
    `в таблице ${live}`,
  );
  await frame2.evaluate(() => sessionStorage.removeItem('__lb_dataFail'));

  await browser.close();

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nПроверок: ${results.length}, провалено: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
