/**
 * Нагрузочная проверка на тех устройствах, где модерация Яндекса гоняла игру:
 *   iOS      — iPhone 15 Plus, iOS 18.5, Safari, 2796x1290 (CSS 430x932 @3)
 *   Android  — Samsung Galaxy A26, Android 16, Yandex Browser (CSS 411x891 @2.625)
 *   Desktop  — Windows 11, Yandex Browser, 2560x1440
 * Мобильные гоняются и портретом, и ландшафтом: обрезку по п. 1.10.1 поймали
 * именно лёжа. Десктоп — в полном окне и в размере встроенного вью (iframe).
 *
 * Один прогон = партия из нескольких вопросов. После каждого шага смотрим:
 *   - ошибки JS и сообщения console.error;
 *   - неудачные запросы (404 по картинкам — главный риск после чистки базы);
 *   - вылезание любого видимого элемента за край экрана (п. 1.10.1);
 *   - прокрутку страницы;
 *   - дубли среди вариантов ответа (вопрос без решения);
 *   - пустой канвас (картинка не отрисовалась);
 *   - что выделение текста реально запрещено (п. 1.6.1.8).
 *
 * Нужен дев-сервер: npm run serve.
 *
 * Запуск:
 *   node scripts/stress-test.mjs 100          — 100 прогонов вслепую, быстро
 *   node scripts/stress-test.mjs 100 3        — то же, но 3 вкладки параллельно
 *   node scripts/stress-test.mjs 6 1 --live   — окно браузера видно, каждый шаг
 *                                               печатается: смотреть глазами
 */
import puppeteer from 'puppeteer-core';
import { chromePath } from './lib.mjs';

const CHROME = chromePath();
const URL = `http://localhost:${process.env.PORT || 8080}/`;
const RUNS = Number(process.argv[2] || 100);
const QUESTIONS = 6; // вопросов за прогон
const LIVE = process.argv.includes('--live');
// Вживую смотреть можно только по одной вкладке; вслепую — пять сразу.
const CONCURRENCY = LIVE ? 1 : Number(process.argv[3]) || 4;
/** Замедление в живом режиме, чтобы шаги было видно глазами. */
const SLOW_MO = LIVE ? 120 : 0;
const say = (msg) => LIVE && console.log(msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 16; SM-A266B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 YaBrowser/26.67.0.0 Mobile Safari/537.36';
const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 YaBrowser/26.6.4.640 Safari/537.36';

/** CSS-вьюпорты посчитаны из физического разрешения и плотности устройства. */
const PROFILES = [
  { name: 'ios-portrait', w: 430, h: 932, dsf: 3, mobile: true, ua: UA_IOS },
  { name: 'ios-landscape', w: 932, h: 430, dsf: 3, mobile: true, ua: UA_IOS },
  { name: 'android-portrait', w: 411, h: 891, dsf: 2.625, mobile: true, ua: UA_ANDROID },
  { name: 'android-landscape', w: 891, h: 411, dsf: 2.625, mobile: true, ua: UA_ANDROID },
  { name: 'desktop-full', w: 2560, h: 1440, dsf: 1, mobile: false, ua: UA_DESKTOP },
  { name: 'desktop-embed', w: 1000, h: 630, dsf: 1, mobile: false, ua: UA_DESKTOP },
];

/**
 * Ошибки, которые возникают только потому, что локально игра открыта не внутри
 * iframe Яндекса: SDK пытается достучаться до родительского окна и до своих
 * доменных ресурсов. На площадке их нет — в отчёте считаем отдельно, чтобы они
 * не заслоняли настоящие проблемы.
 */
const OFFSITE = [
  'No parent to post message',
  'games.yandex',
  'yandex.ru/games/sdk',
  'an.yandex',
  'mc.yandex',
];
const isOffsite = (msg) => OFFSITE.some((f) => msg.includes(f));

const MODES = ['#btn-play', '#btn-play-timed', '#btn-play-hard'];
const KINDS = ['mix', 'icon', 'shot'];

/** Проверка текущего экрана — выполняется внутри страницы. */
function inspect() {
  const de = document.documentElement;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const issues = [];

  if (de.scrollWidth > de.clientWidth + 1) issues.push(`h-scroll ${de.scrollWidth}>${de.clientWidth}`);
  if (de.scrollHeight > de.clientHeight + 1) issues.push(`v-scroll ${de.scrollHeight}>${de.clientHeight}`);

  // Всё видимое и осмысленное: если элемент вылез за край — это п. 1.10.1.
  const named = [];
  for (const sel of ['#screen-start', '#screen-game', '#screen-over', '#reveal', '#boards', '#credits']) {
    const scr = document.querySelector(`${sel}:not([hidden])`);
    if (!scr) continue;
    scr.querySelectorAll('button, .option, .photo, .timer, .hud, .title, .modal__box').forEach((n, i) => {
      named.push([`${sel.slice(1)}>${(n.className || '').toString().split(' ')[0] || n.id || 'el'}#${i}`, n]);
    });
  }
  for (const [name, n] of named) {
    if (n.offsetParent === null && getComputedStyle(n).position !== 'fixed') continue;
    const r = n.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
      issues.push(
        `обрезан ${name} [${Math.round(r.left)},${Math.round(r.top)}=>${Math.round(r.right)},${Math.round(r.bottom)}] vp ${vw}x${vh}`,
      );
    }
  }

  // Варианты ответа: их должно быть 4 и все разные.
  const opts = [...document.querySelectorAll('#options .option')].map((n) => n.textContent.trim());
  if (opts.length) {
    if (opts.length !== 4) issues.push(`вариантов ${opts.length}, а не 4`);
    if (new Set(opts).size !== opts.length) issues.push(`дубли вариантов: ${opts.join(' | ')}`);
  }

  // Канвас: отрисовалась ли картинка.
  const c = document.getElementById('canvas');
  if (c && c.offsetParent !== null) {
    if (!c.width || !c.height) {
      issues.push('канвас нулевого размера');
    } else {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) lit++;
      if (lit === 0) issues.push('канвас пустой — картинка не нарисовалась');
    }
  }

  // Выделение текста должно быть запрещено, иначе на iOS всплывёт «Скопировать».
  const probe = document.querySelector('#options .option') || document.querySelector('.title');
  if (probe) {
    const st = getComputedStyle(probe);
    const sel = st.webkitUserSelect || st.userSelect;
    if (sel && sel !== 'none') issues.push(`user-select=${sel}`);
    const callout = st.webkitTouchCallout;
    if (callout && callout !== 'none') issues.push(`touch-callout=${callout}`);
  }
  return issues;
}

async function oneRun(browser, profile, seed) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`JS: ${e.message.split('\n')[0]}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 120)}`);
  });
  page.on('requestfailed', (r) => errors.push(`запрос упал: ${r.url().split('/').pop()}`));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url().split('/').pop()}`);
  });

  try {
    await page.setUserAgent(profile.ua);
    await page.setViewport({
      width: profile.w,
      height: profile.h,
      deviceScaleFactor: profile.dsf,
      isMobile: profile.mobile,
      hasTouch: profile.mobile,
    });
    say(`
[${profile.name}] прогон #${seed + 1} — открываю игру (${profile.w}x${profile.h} @${profile.dsf})`);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#screen-start:not([hidden])', { timeout: 40000 });
    await sleep(150);
    errors.push(...(await page.evaluate(inspect)).map((s) => `меню: ${s}`));

    const kind = KINDS[seed % KINDS.length];
    const mode = MODES[seed % MODES.length];
    if (mode === '#btn-play' && kind !== 'mix') await page.click(`#kind [data-kind="${kind}"]`);
    say(`[${profile.name}] режим ${mode.replace('#btn-play', '') || 'обычный'}, картинки: ${kind}`);
    await page.click(mode);
    await page.waitForSelector('#screen-game:not([hidden]) .option', { timeout: 15000 });

    for (let q = 0; q < QUESTIONS; q++) {
      await page.waitForFunction(
        () => {
          const c = document.getElementById('canvas');
          return c && c.width > 0;
        },
        { timeout: 15000 },
      );
      await sleep(220);
      errors.push(...(await page.evaluate(inspect)).map((s) => `вопрос: ${s}`));

      const opts = await page.$$('#options .option:not([disabled])');
      if (!opts.length) break;
      if (LIVE) {
        const texts = await page.$$eval('#options .option', (ns) => ns.map((n) => n.textContent.trim()));
        say(`[${profile.name}]   вопрос ${q + 1}: ${texts.join(' / ')}`);
      }
      await opts[(seed + q) % opts.length].click();
      await page.waitForSelector('#reveal:not([hidden])', { timeout: 8000 });
      await sleep(180);
      errors.push(...(await page.evaluate(inspect)).map((s) => `разбор: ${s}`));

      if (LIVE) {
        const verdict = await page.$eval('#reveal-verdict', (e) => e.textContent.trim()).catch(() => '?');
        const answer = await page.$eval('#reveal-answer', (e) => e.textContent.trim()).catch(() => '');
        say(`[${profile.name}]   -> ${verdict} ${answer}`);
      }
      const over = await page.$eval('#btn-next', (e) => e.textContent.trim() === 'Итоги').catch(() => false);
      await page.click('#btn-next').catch(() => {});
      if (over) {
        await page.waitForSelector('#screen-over:not([hidden])', { timeout: 8000 });
        await sleep(200);
        errors.push(...(await page.evaluate(inspect)).map((s) => `итоги: ${s}`));
        await page.click('#btn-again').catch(() => {});
        await page.waitForSelector('#screen-game:not([hidden]) .option', { timeout: 15000 }).catch(() => {});
      }
    }
  } catch (e) {
    errors.push(`сорвался прогон: ${e.message.split('\n')[0]}`);
  }
  await page.close().catch(() => {});
  return errors;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: LIVE ? false : 'new',
  slowMo: SLOW_MO,
  // Под параллельными вкладками Chrome иногда не успевает ответить по CDP на
  // дефолтных 30 секундах — это срыв стенда, а не ошибка игры. Даём запас.
  protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});

const tally = new Map();
let offsiteTotal = 0;
const perProfile = new Map(PROFILES.map((p) => [p.name, { runs: 0, bad: 0 }]));
let done = 0;

const queue = Array.from({ length: RUNS }, (_, i) => i);
async function worker() {
  while (queue.length) {
    const i = queue.shift();
    const profile = PROFILES[i % PROFILES.length];
    const errs = await oneRun(browser, profile, i);
    const st = perProfile.get(profile.name);
    st.runs++;
    const offsite = errs.filter(isOffsite);
    const real = errs.filter((e) => !isOffsite(e));
    offsiteTotal += offsite.length;
    if (real.length) st.bad++;
    for (const e of real) {
      const key = `${profile.name} :: ${e.replace(/\d+/g, '#')}`;
      if (!tally.has(key)) tally.set(key, { count: 0, sample: `${profile.name} :: ${e}` });
      tally.get(key).count++;
    }
    done++;
    if (real.length) real.forEach((e) => console.log(`  ! ${profile.name}: ${e}`));
    if (!LIVE && done % 10 === 0) console.log(`  ...${done}/${RUNS}`);
  }
}

console.log(
  `Прогонов: ${RUNS}, вопросов в каждом: ${QUESTIONS}, профилей: ${PROFILES.length}, ` +
    `вкладок параллельно: ${CONCURRENCY}${LIVE ? ', режим: ЖИВОЙ (окно браузера видно)' : ''}`,
);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await browser.close();

console.log('\n=== По устройствам ===');
for (const [name, st] of perProfile) {
  console.log(`${st.bad ? 'WARN ' : 'OK   '}${name.padEnd(18)} прогонов ${st.runs}, с замечаниями ${st.bad}`);
}
console.log('\n=== Замечания ===');
if (!tally.size) {
  console.log('нет ни одного');
} else {
  [...tally.values()]
    .sort((a, b) => b.count - a.count)
    .forEach((v) => console.log(`${String(v.count).padStart(4)}x  ${v.sample}`));
}
