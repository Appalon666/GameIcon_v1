/**
 * Прогоняет по игре сторонний Yandex Games Debug Checker
 * (https://github.com/Nioris/yandex-games-debug-checker) и печатает его вердикты.
 *
 * Чекер — клиентский скрипт: его подключают в <head> после SDK и до игровых
 * скриптов, а результат он рисует в своей панели. Класть его в `public/` нельзя
 * (README требует убирать перед релизом), поэтому здесь поднимается временный
 * прокси на 8081: все файлы отдаются из `public/` как есть, и только в
 * `index.html` на лету вставляется тег со скриптом. Релизная сборка не меняется.
 *
 * Перед снятием отчёта играется несколько раундов — иначе runtime-проверки
 * (порядок вызовов SDK, тайминги, реклама) смотрят на пустую страницу.
 *
 * Запуск: node scripts/run-debugchecker.mjs [путь-к-клону]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import { join, extname } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CHECKER_DIR = process.argv[2] || 'C:/yandex-games-debug-checker';
const CHECKER_FILE = join(CHECKER_DIR, 'debugcheck.js');
const PUBLIC = 'public';
const PORT = 8081;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(CHECKER_FILE)) {
  console.error(`Не найден ${CHECKER_FILE}. Клонируй репозиторий или укажи путь аргументом.`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (path === '/debugcheck.js') {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      res.end(await readFile(CHECKER_FILE));
      return;
    }
    // На площадке /sdk.js отдаёт Яндекс — здесь проксируем, как и дев-сервер.
    if (path === '/sdk.js') {
      let body = '/* SDK недоступен: локальный режим без YaGames */';
      try { body = await (await fetch('https://yandex.ru/games/sdk/v2')).text(); } catch {}
      res.writeHead(200, { 'content-type': MIME['.js'] });
      res.end(body);
      return;
    }
    if (path === '/' || path === '/index.html') {
      let html = await readFile(join(PUBLIC, 'index.html'), 'utf8');
      // Строго после SDK и до игровых скриптов — так требует README чекера.
      html = html.replace(
        '<script src="/sdk.js"></script>',
        '<script src="/sdk.js"></script>\n  <script src="/debugcheck.js"></script>',
      );
      // Чекер собирает исходники только по тегам <script src> и НЕ ходит по
      // ES-импортам. Точка входа у нас — модуль main.js, а sdk.js, game.js,
      // render.js и icons.js подключены импортами и остаются для него
      // невидимыми: он рапортует «не найдено» про код, который есть.
      // Перечисляем их тегами явно — модули кешируются по URL и повторно не
      // выполняются, поведение страницы не меняется.
      html = html.replace(
        '<script type="module" src="js/main.js"></script>',
        ['sdk', 'game', 'render', 'icons']
          .map((n) => `<script type="module" src="js/${n}.js"></script>`)
          .join('\n  ') + '\n  <script type="module" src="js/main.js"></script>',
      );
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(html);
      return;
    }
    const file = join(PUBLIC, path.replace(/^\/+/, ''));
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('нет такого файла'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e.message));
  }
});
await new Promise((r) => server.listen(PORT, r));
console.log(`прокси с чекером: http://localhost:${PORT}/`);
// Порт освобождаем при любом исходе: после падения прогона он оставался занят,
// и следующий запуск падал с EADDRINUSE.
const release = () => { try { server.close(); } catch {} };
process.on('exit', release);
process.on('SIGINT', () => { release(); process.exit(130); });
process.on('uncaughtException', (e) => { release(); console.error(e); process.exit(1); });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#screen-start:not([hidden])', { timeout: 40000 });

// Немного играем: runtime-проверки смотрят на реальный порядок вызовов SDK.
await page.click('#btn-play');
await page.waitForSelector('#screen-game:not([hidden]) .option', { timeout: 20000 });
for (let i = 0; i < 3; i++) {
  await sleep(600);
  const opts = await page.$$('#options .option:not([disabled])');
  if (!opts.length) break;
  await opts[0].click();
  await page.waitForSelector('#reveal:not([hidden])', { timeout: 8000 }).catch(() => {});
  await sleep(300);
  await page.click('#btn-next').catch(() => {});
}
await sleep(1000);

const version = await page.evaluate(() => window.YGDebugChecker?.version || null);
if (!version) {
  console.error('Чекер не подключился: window.YGDebugChecker отсутствует.');
  pageErrors.forEach((e) => console.error('  ошибка страницы:', e));
  await browser.close();
  server.close();
  process.exit(1);
}
console.log(`чекер версии ${version} подключился\n`);

await page.evaluate(() => window.YGDebugChecker.open());
await sleep(2500);

const rows = await page.evaluate(() => {
  const cls = (n) => [...n.classList].find((c) => c.startsWith('dc-') && c !== 'dc-icon') || '';
  return [...document.querySelectorAll('.dc-row')].map((row) => {
    const icon = row.querySelector('.dc-icon');
    const map = { 'dc-pass': 'PASS', 'dc-warn': 'WARN', 'dc-fail': 'FAIL', 'dc-nv': 'NOT VERIFIED' };
    const nameEl = row.querySelector('.dc-name');
    const meta = nameEl?.querySelector('.dc-meta')?.textContent.trim() || '';
    const name = nameEl ? nameEl.textContent.replace(meta, '').trim() : '';
    return {
      status: map[cls(icon)] || '?',
      meta,
      name,
      desc: row.querySelector('.dc-desc')?.textContent.trim() || '',
      detail: row.querySelector('.dc-det')?.textContent.trim() || '',
    };
  });
});

await browser.close();
server.close();

if (!rows.length) {
  console.error('Панель чекера открылась, но строк с проверками в ней нет.');
  process.exit(1);
}

const order = ['FAIL', 'WARN', 'NOT VERIFIED', 'PASS'];
const byStatus = new Map(order.map((s) => [s, rows.filter((r) => r.status === s)]));
console.log('=== ИТОГ СТОРОННЕГО ЧЕКЕРА ===');
for (const s of order) console.log(`${s.padEnd(13)} ${byStatus.get(s).length}`);
console.log(`ВСЕГО         ${rows.length}\n`);

for (const s of ['FAIL', 'WARN', 'NOT VERIFIED']) {
  const list = byStatus.get(s);
  if (!list.length) continue;
  console.log(`\n--- ${s} (${list.length}) ---`);
  list.forEach((r) => {
    console.log(`[${r.meta}] ${r.name}`);
    console.log(`   что проверяет: ${r.desc}`);
    console.log(`   вердикт: ${r.detail}`);
  });
}
if (pageErrors.length) {
  console.log('\n--- ошибки страницы во время прогона ---');
  [...new Set(pageErrors)].forEach((e) => console.log('  ' + e));
}
process.exit(byStatus.get('FAIL').length ? 1 : 0);
