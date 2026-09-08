/**
 * Сквозная проверка по всем замечаниям модерации Яндекс Игр (см. MODERATION.md).
 * Идёт по пунктам требований и на каждый даёт вердикт ОК/ПРОВАЛ с деталями.
 *
 * Часть проверок статические (файлы, данные, архив), часть — в реальном
 * браузере на тех устройствах, где игру гоняла модерация. В браузере
 * обходятся ВСЕ экраны, включая модалки «Лидерборды» и «Об игре»: обрезку
 * можно словить и там.
 *
 * Нужен дев-сервер: npm run serve. Запуск: node scripts/verify-moderation.mjs
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = `http://localhost:${process.env.PORT || 8080}/`;
const NAME = 'Угадай игру по иконке и скриншоту';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (item, ok, detail) => results.push({ item, ok, detail });

/** Устройства из отчёта модерации: CSS-вьюпорт посчитан из физики и плотности. */
const DEVICES = [
  { name: 'iPhone 15 Plus, портрет', w: 430, h: 932, dsf: 3, mobile: true },
  { name: 'iPhone 15 Plus, лёжа', w: 932, h: 430, dsf: 3, mobile: true },
  { name: 'Galaxy A26, портрет', w: 411, h: 891, dsf: 2.625, mobile: true },
  { name: 'Galaxy A26, лёжа', w: 891, h: 411, dsf: 2.625, mobile: true },
  { name: 'Desktop 2560x1440', w: 2560, h: 1440, dsf: 1, mobile: false },
  { name: 'Встроенный вью', w: 1000, h: 630, dsf: 1, mobile: false },
];

// ---------------------------------------------------------------- статика

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const html = fs.readFileSync('public/index.html', 'utf8');
const games = read('public/data/games.json');
const icons = read('public/data/icons.json');
const shots = read('public/data/shots.json');

// п. 5.1.3 — название одинаково везде.
{
  const title = html.match(/<title>(.*?)<\/title>/)?.[1];
  const h1 = html.match(/<h1 class="title">(.*?)<\/h1>/)?.[1];
  const listing = fs.readFileSync('LISTING.md', 'utf8');
  const aboutUsesFullName = listing.includes(`«${NAME}» — викторина`);
  const bad = [];
  if (title !== NAME) bad.push(`<title> = «${title}»`);
  if (h1 !== NAME) bad.push(`<h1> = «${h1}»`);
  if (!aboutUsesFullName) bad.push('в «Об игре» название не полное');
  check('п. 5.1.3 — название одинаково в игре и в карточке', !bad.length, bad.join('; ') || `везде «${NAME}»`);
}

// п. 8.4.2 — никаких ссылок и доменов.
{
  const files = ['public/index.html', 'public/css/style.css', ...fs.readdirSync('public/js').map((f) => `public/js/${f}`)];
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
      // SDK Яндекса разрешён требованиями, а w3.org/2000/svg — не ссылка, а
      // обязательное пространство имён для createElementNS: браузер по нему
      // никуда не ходит и пользователю оно не видно.
      if (m[0].startsWith('https://yandex.ru/games/sdk')) continue;
      if (m[0] === 'http://www.w3.org/2000/svg') continue;
      hits.push(`${f}: ${m[0]}`);
    }
    // Домены без протокола — как раз такие были в модалке «Об игре».
    for (const m of src.matchAll(/\b[a-z0-9-]+\.(?:com|ru|net|org|io)\b/gi)) {
      const ctx = src.slice(Math.max(0, m.index - 40), m.index + 40);
      if (/@|import|url\(|\.js|\.css|\.png|\.jpg|\.json/.test(ctx)) continue;
      hits.push(`${f}: ${m[0]}`);
    }
  }
  const anchors = [...html.matchAll(/<a\s[^>]*href=/gi)].length;
  if (anchors) hits.push(`тегов <a href>: ${anchors}`);
  check('п. 8.4.2 — в игре нет ссылок и доменов', !hits.length, hits.join('; ') || 'только SDK Яндекса');
}

// п. 8.2.5 — вычищенный контент отсутствует и в данных, и на диске.
{
  const gone = ['schedule-i', 'postal-2', 'mirror', 'crush-crush', 'love-is-all-around'];
  const goneShots = ['wolfenstein-ii-the-new-colossus-1.jpg', 'cyberpunk-2077-1.jpg', 'tower-of-fantasy-1.jpg'];
  const goneIcons = ['company-of-heroes-legacy-edition.png', 'return-to-castle-wolfenstein.png'];
  const bad = [];
  for (const id of gone) {
    if (games.games.some((g) => g.id === id)) bad.push(`игра ${id} осталась в базе`);
    if (fs.existsSync(`public/img/icons/${id}.png`)) bad.push(`иконка ${id} на диске`);
  }
  for (const f of goneShots) if (fs.existsSync(`public/img/shots/${f}`)) bad.push(`кадр ${f} на диске`);
  for (const f of goneIcons) if (fs.existsSync(`public/img/icons/${f}`)) bad.push(`иконка ${f} на диске`);
  check('п. 8.2.5 — свастика, наркотики, эротика убраны', !bad.length, bad.join('; ') || `убрано ${gone.length} игр, ${goneShots.length} кадров, ${goneIcons.length} иконок`);
}

// Целостность данных: ни сирот, ни битых ссылок, ни лишних файлов.
{
  const ids = new Set(games.games.map((g) => g.id));
  const bad = [];
  for (const [dir, list] of [['icons', icons.icons], ['shots', shots.shots]]) {
    for (const it of list) {
      if (!ids.has(it.gameId)) bad.push(`${it.file}: нет игры ${it.gameId}`);
      if (!fs.existsSync(`public/img/${dir}/${it.file}`)) bad.push(`${it.file}: файла нет`);
    }
    const refs = new Set(list.map((x) => x.file));
    for (const f of fs.readdirSync(`public/img/${dir}`)) if (!refs.has(f)) bad.push(`${dir}/${f}: файл не нужен`);
  }
  check('Данные — нет сирот, битых ссылок и лишних файлов', !bad.length,
    bad.slice(0, 5).join('; ') || `${games.count} игр, ${icons.count} иконок, ${shots.count} скринов`);
}

// Дубли названий: из-за них в вопросе оказывались два одинаковых варианта.
{
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9а-я ]/g, ' ')
    .replace(/\b(the|complete|edition|definitive|remastered|goty|game of the year|deluxe|ultimate|retired|hd|classic)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  const seen = new Map();
  for (const g of games.games) {
    const k = norm(g.name);
    seen.set(k, [...(seen.get(k) || []), g.name]);
  }
  const dups = [...seen.values()].filter((v) => v.length > 1);
  check('Дубли игр — вопросов без решения нет', !dups.length,
    dups.length ? dups.slice(0, 3).map((v) => v.join(' == ')).join('; ') : 'ни одной группы дублей');
}

// п. 5.1.1.2 — промо: 8 кадров, верные пропорции, меню среди них нет.
{
  const want = [
    ['promo/pc-1-icons.png', 1920, 1080], ['promo/pc-2-shots.png', 1920, 1080],
    ['promo/pc-3-correct.png', 1920, 1080], ['promo/pc-4-timed.png', 1920, 1080],
    ['promo/mobile-1-icons.png', 1080, 1920], ['promo/mobile-2-shots.png', 1080, 1920],
    ['promo/mobile-3-correct.png', 1080, 1920], ['promo/mobile-4-timed.png', 1080, 1920],
  ];
  const bad = [];
  for (const [f, w, h] of want) {
    if (!fs.existsSync(f)) { bad.push(`${f}: нет файла`); continue; }
    try {
      const size = execFileSync('magick', ['identify', '-format', '%wx%h', f]).toString();
      if (size !== `${w}x${h}`) bad.push(`${f}: ${size}, ждали ${w}x${h}`);
    } catch { bad.push(`${f}: не удалось прочитать размер`); }
  }
  if (fs.readdirSync('promo').some((f) => f.includes('menu'))) bad.push('в promo остался кадр меню');
  check('п. 5.1.1.2 — промо: 8 кадров геймплея в нужных размерах', !bad.length, bad.join('; ') || 'все 8 на месте');
}

// Архив: содержит ли он то же, что и public, и нет ли в нём вычищенного.
{
  const bad = [];
  if (!fs.existsSync('dist/game.zip')) {
    bad.push('архива нет — нужен npm run pack');
  } else {
    const listing = execFileSync('python', ['-c',
      "import zipfile,sys; print('\\n'.join(zipfile.ZipFile('dist/game.zip').namelist()))"]).toString();
    const names = listing.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!names.includes('index.html')) bad.push('index.html не в корне архива');
    if (names.some((n) => n.includes('\\'))) bad.push('в путях обратные слэши');
    for (const f of ['schedule-i-1.jpg', 'postal-2-1.jpg', 'wolfenstein-ii-the-new-colossus-1.jpg', 'mirror-1.jpg']) {
      if (names.some((n) => n.endsWith(f))) bad.push(`в архиве остался ${f}`);
    }
    const mb = (fs.statSync('dist/game.zip').size / 1048576).toFixed(1);
    if (!bad.length) check.detail = `${names.length} файлов, ${mb} МБ`;
    if (!bad.length) bad.detail = null;
    check('Архив — собран, чистый, index.html в корне', true, `${names.length} файлов, ${mb} МБ`);
  }
  if (bad.length) check('Архив — собран, чистый, index.html в корне', false, bad.join('; '));
}

// ---------------------------------------------------------------- браузер

/** Обходит все экраны и модалки, возвращает список обрезанных элементов. */
function auditScreens() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = [];
  const scan = (where) => {
    for (const sel of ['#screen-start', '#screen-game', '#screen-over', '#reveal', '#boards', '#credits']) {
      const scr = document.querySelector(`${sel}:not([hidden])`);
      if (!scr) continue;
      for (const n of scr.querySelectorAll('button, .option, .photo, .timer, .hud, .title, .modal__box, .board__list')) {
        if (n.offsetParent === null && getComputedStyle(n).position !== 'fixed') continue;
        const r = n.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
          const id = n.id || (n.className || '').toString().split(' ')[0];
          out.push(`${where}: ${sel.slice(1)}>${id} [${Math.round(r.left)},${Math.round(r.top)}=>${Math.round(r.right)},${Math.round(r.bottom)}]`);
        }
      }
    }
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) out.push(`${where}: горизонтальная прокрутка`);
    if (de.scrollHeight > de.clientHeight + 1) out.push(`${where}: вертикальная прокрутка`);
  };
  return { scan: scan.toString(), out };
}

async function auditDevice(browser, dev) {
  const page = await browser.newPage();
  const bad = [];
  const net = [];
  page.on('response', (r) => { if (r.status() >= 400) net.push(`HTTP ${r.status()} ${r.url().split('/').pop()}`); });
  page.on('pageerror', (e) => { if (!e.message.includes('No parent to post message')) bad.push(`JS: ${e.message.split('\n')[0]}`); });

  await page.setViewport({ width: dev.w, height: dev.h, deviceScaleFactor: dev.dsf, isMobile: dev.mobile, hasTouch: dev.mobile });
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // Подставляем рекорд: у вернувшегося игрока на стартовом экране появляется
  // строка «Твой рекорд: …», и меню становится выше. Именно с ней оно вылезало
  // за края во встроенном вью 1000x630 — проверять надо худший случай, а не
  // чистый профиль.
  await page.evaluate(() =>
    localStorage.setItem('best', JSON.stringify({ total: 1234, icons: 900, shots: 800, timetotal: 700, hardcore: 500 })),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#screen-start:not([hidden])', { timeout: 40000 });

  /** Проверяет текущий экран и возвращает обрезанные элементы. */
  const look = (where) =>
    page.evaluate((w) => {
      const vw = window.innerWidth, vh = window.innerHeight, out = [];
      for (const sel of ['#screen-start', '#screen-game', '#screen-over', '#reveal', '#boards', '#credits']) {
        const scr = document.querySelector(`${sel}:not([hidden])`);
        if (!scr) continue;
        for (const n of scr.querySelectorAll('button, .option, .photo, .timer, .hud, .title, .modal__box, .board__list')) {
          if (n.offsetParent === null && getComputedStyle(n).position !== 'fixed') continue;
          const r = n.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1) {
            const id = n.id || (n.className || '').toString().split(' ')[0];
            out.push(`${w}: ${sel.slice(1)}>${id} [${Math.round(r.left)},${Math.round(r.top)}=>${Math.round(r.right)},${Math.round(r.bottom)}] vp ${vw}x${vh}`);
          }
        }
      }
      const de = document.documentElement;
      if (de.scrollWidth > de.clientWidth + 1) out.push(`${w}: горизонтальная прокрутка`);
      if (de.scrollHeight > de.clientHeight + 1) out.push(`${w}: вертикальная прокрутка`);
      return out;
    }, where);

  bad.push(...(await look('меню')));

  // Модалки — их раньше никто не проверял.
  await page.click('#btn-board');
  await sleep(400);
  bad.push(...(await look('лидерборды')));
  await page.click('#btn-boards-close');
  await sleep(200);

  await page.click('#btn-credits');
  await sleep(300);
  bad.push(...(await look('об игре')));
  // Заодно: не осталось ли доменов в тексте модалки.
  const creditsDomains = await page.$eval('#credits .modal__box', (el) => (el.innerText.match(/[a-z0-9-]+\.(com|ru|net|org|io)/gi) || []));
  if (creditsDomains.length) bad.push(`об игре: домены ${creditsDomains.join(', ')}`);
  await page.click('#btn-credits-close');
  await sleep(200);

  // Партия: вопрос, разбор, и так несколько раз.
  await page.click('#btn-play');
  await page.waitForSelector('#screen-game:not([hidden]) .option', { timeout: 15000 });
  const optionSets = [];
  for (let q = 0; q < 5; q++) {
    await page.waitForFunction(() => { const c = document.getElementById('canvas'); return c && c.width > 0; }, { timeout: 15000 });
    await sleep(250);
    bad.push(...(await look(`вопрос ${q + 1}`)));
    optionSets.push(await page.$$eval('#options .option', (ns) => ns.map((n) => n.textContent.trim())));
    const opts = await page.$$('#options .option:not([disabled])');
    if (!opts.length) break;
    await opts[q % opts.length].click();
    await page.waitForSelector('#reveal:not([hidden])', { timeout: 8000 });
    await sleep(200);
    bad.push(...(await look(`разбор ${q + 1}`)));
    const over = await page.$eval('#btn-next', (e) => e.textContent.trim() === 'Итоги').catch(() => false);
    await page.click('#btn-next').catch(() => {});
    if (over) {
      await page.waitForSelector('#screen-over:not([hidden])', { timeout: 8000 });
      await sleep(250);
      bad.push(...(await look('итоги')));
      await page.click('#btn-again').catch(() => {});
      await page.waitForSelector('#screen-game:not([hidden]) .option', { timeout: 15000 }).catch(() => {});
    }
  }

  // Запрет выделения — на элементах, до которых реально дотрагиваются.
  const sel = await page.evaluate(() => {
    const out = [];
    for (const s of ['.option', '.btn', '.chip', '.mode', '.title', '.photo']) {
      const n = document.querySelector(s);
      if (!n) continue;
      const st = getComputedStyle(n);
      const us = st.webkitUserSelect || st.userSelect;
      if (us !== 'none') out.push(`${s}: user-select=${us}`);
      if (st.webkitTouchCallout && st.webkitTouchCallout !== 'none') out.push(`${s}: touch-callout=${st.webkitTouchCallout}`);
    }
    return out;
  });
  bad.push(...sel);

  const dupSets = optionSets.filter((s) => new Set(s).size !== s.length);
  if (dupSets.length) bad.push(`дубли вариантов: ${dupSets[0].join(' | ')}`);
  bad.push(...net);

  await page.close();
  return bad;
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});

const layout = [];
for (const dev of DEVICES) {
  const bad = await auditDevice(browser, dev);
  layout.push({ dev: dev.name, bad });
  console.log(`${bad.length ? 'ПРОВАЛ' : 'ОК    '} ${dev.name}`);
  bad.forEach((b) => console.log(`         ${b}`));
}
await browser.close();

const layoutBad = layout.flatMap((l) => l.bad);
check('п. 1.10.1 — ничего не обрезано на всех экранах и модалках', !layoutBad.length,
  layoutBad.slice(0, 4).join('; ') || `${DEVICES.length} устройств, все экраны чисты`);
check('п. 1.6.1.8 — выделение текста и контекстное меню запрещены', !layoutBad.some((b) => b.includes('user-select') || b.includes('callout')),
  'user-select: none и touch-callout: none на всех интерактивных элементах');

console.log('\n================ ИТОГ ПО ЗАМЕЧАНИЯМ ================');
for (const r of results) {
  console.log(`${r.ok ? '[ ОК ]' : '[ПРОВАЛ]'} ${r.item}`);
  console.log(`        ${r.detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nПроверок: ${results.length}, провалено: ${failed}`);
process.exit(failed ? 1 : 0);
