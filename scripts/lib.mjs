/** Мелкие утилиты, общие для скриптов пайплайна. */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'public', 'data');
export const IMG = join(ROOT, 'public', 'img');
export const CACHE = join(ROOT, 'scripts', '.cache');

const UA = 'Mozilla/5.0 (game-icon-quiz builder)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Транслитерация в безопасный slug для id и имён файлов. */
export function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'x';
}

/**
 * Запускает curl. Node-fetch (undici) рвёт соединение с некоторыми серверами
 * (SteamSpy — ECONNRESET), а системный curl работает стабильно, поэтому вся
 * сеть скриптов идёт через него.
 * @returns {Promise<{status:number, body:Buffer}>}
 */
function curl(url, { timeout = 30, headers = [], out = null } = {}) {
  const args = [
    '-sS',
    '--compressed',
    '-m', String(timeout),
    '-A', UA,
    '-w', '\n%{http_code}',
  ];
  for (const h of headers) args.push('-H', h);
  if (out) args.push('-o', out);
  args.push(url);

  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 128 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
      if (err) return reject(err);
      // Последняя строка stdout — код ответа (из -w). При -o тело ушло в файл.
      const buf = stdout;
      const nl = buf.lastIndexOf(0x0a);
      const status = Number(buf.slice(nl + 1).toString().trim());
      const body = out ? Buffer.alloc(0) : buf.slice(0, nl);
      resolve({ status, body });
    });
  });
}

/** GET с ретраями. Возвращает {status, body:Buffer}. */
export async function get(url, { tries = 3, timeout = 30, headers = [] } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await curl(url, { timeout, headers });
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * (i + 1));
        lastErr = new Error(`${url}: HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr ?? new Error(`не удалось: ${url}`);
}

export async function getJSON(url, opts) {
  const res = await get(url, opts);
  if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
  return JSON.parse(res.body.toString('utf8'));
}

/** Скачивает файл по url в dest через curl. */
export async function download(url, dest, { timeout = 40, headers = [] } = {}) {
  await mkdir(dirname(dest), { recursive: true });
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await curl(url, { timeout, headers, out: dest });
      if (res.status === 200) return true;
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (i + 1));
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr ?? new Error(`не скачалось: ${url}`);
}

export async function readJSON(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJSON(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
