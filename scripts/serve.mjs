/**
 * Дев-сервер: раздаёт public/ на http://localhost:8080/.
 * Сборки нет — это статические файлы, public/ заливается в Яндекс Игры как есть.
 *
 * Эндпоинт POST /save принимает разметку из редактора замазки и пишет её
 * прямо в public/data/icons.json или shots.json (по полю kind).
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { ROOT, DATA } from './lib.mjs';
import { buildBundle, describeBundle } from './bundle.mjs';

const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

/**
 * Локальная подмена /sdk.js: на площадке этот файл отдаёт сам Яндекс, а в
 * разработке его нет. Проксируем на публичный адрес SDK, чтобы локально
 * работал тот же код, что и в проде. Если сети нет — отдаём пустышку, игра
 * переживает отсутствие YaGames и уходит в локальный режим.
 */
let sdkCache = null;
async function serveSdk(res) {
  // Кешируем в памяти: автотесты открывают страницу сотни раз, и поход в сеть
  // на каждую загрузку упирался в таймаут навигации.
  if (sdkCache === null) {
    try {
      sdkCache = await (await fetch('https://yandex.ru/games/sdk/v2')).text();
    } catch {
      sdkCache = '/* SDK недоступен: локальный режим без YaGames */';
    }
  }
  res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
  res.end(sdkCache);
}

async function serveFile(res, path) {
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}

/**
 * Пишет размеченные области/флаги из редактора в нужный набор данных.
 * Тело: { kind: 'icon'|'shot', marks: { "<file>": [[x,y,w,h],...] | "clean" | "skip" } }.
 */
async function saveMarks(res, body) {
  try {
    const { kind, marks } = JSON.parse(body);
    const fileName = kind === 'shot' ? 'shots.json' : 'icons.json';
    const key = kind === 'shot' ? 'shots' : 'icons';
    const path = join(DATA, fileName);
    const doc = JSON.parse(await readFile(path, 'utf8'));
    const byFile = new Map(doc[key].map((it) => [it.file, it]));

    let n = 0;
    for (const [file, val] of Object.entries(marks)) {
      const it = byFile.get(file);
      if (!it) continue;
      n++;
      if (val === 'skip') {
        it.skip = true;
      } else if (val === 'clean') {
        it.skip = false;
        it.clean = true;
        it.blur = [];
        it.needsReview = false;
      } else if (Array.isArray(val)) {
        it.skip = false;
        it.clean = false;
        it.blur = val.map(([x, y, w, h]) => ({ x, y, w, h }));
        it.needsReview = false;
      }
    }
    await writeFile(path, JSON.stringify(doc, null, 2) + '\n');
    // Игра читает не эти файлы, а data/bundle.json — обновляем и его, иначе
    // редактор сохранил, а игра в соседней вкладке играет по-старому.
    await buildBundle();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, saved: n }));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e.message) }));
  }
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => saveMarks(res, body));
    return;
  }

  // На площадке /sdk.js отдаёт Яндекс, локально его нет — проксируем.
  if (req.url.split('?')[0] === '/sdk.js') {
    serveSdk(res);
    return;
  }

  // Защита от выхода вверх по дереву.
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  // Редактор разметки лежит в tools/ вне public/ — раздаём его из корня.
  const inTools = /^[/\\]tools[/\\]/.test(rel);
  const base = inTools ? ROOT : PUBLIC;
  let path = join(base, rel === '/' || rel === '\\' ? 'index.html' : rel);
  if (rel.endsWith('/')) path = join(path, 'index.html');
  const allowed = inTools ? join(ROOT, 'tools') : PUBLIC;
  if (!path.startsWith(allowed)) {
    res.writeHead(403);
    res.end('403');
    return;
  }
  serveFile(res, path);
});

// bundle.json — генерируемый: данные могли поправить в обход build/pack, а игра
// читает только его. Пересобираем при каждом запуске; если данные битые —
// говорим об этом и раздаём то, что есть.
buildBundle()
  .then((b) => console.log(`[serve] ${describeBundle(b)}`))
  .catch((e) => console.warn(`[serve] bundle не пересобран: ${e.message}`));
server.listen(PORT, () => console.log(`http://localhost:${PORT}/`));
