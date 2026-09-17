/** Мелкие утилиты, общие для скриптов пайплайна. */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Путь к ffmpeg. Он нужен только для сборки промо-ролика, и на машине без
 * ffmpeg в PATH скрипт падал у самой последней команды — после того, как
 * потратил несколько минут на съёмку кадров.
 *
 * Порядок тот же, что у браузера: переменная окружения FFMPEG, потом обычные
 * места установки. В конце — сборки, которые кладут рядом с собой другие
 * программы: у Krita и у некоторых редакторов лежит полноценный ffmpeg с
 * libmp3lame и libx264, и для наших целей он ничем не хуже отдельного.
 */
export function ffmpegPath() {
  return pickFfmpeg().path;
}

/**
 * Чем кодировать H.264. Разные сборки ffmpeg собраны с разным набором
 * кодировщиков, и «просто libx264» есть далеко не везде: у сборки, которая
 * едет в комплекте с Krita, его нет вовсе, и скрипт падал на последней команде
 * — после того, как потратил минуты на съёмку кадров.
 *
 * Порядок предпочтения: libx264 (эталон качества при заданном CRF) → h264_nvenc
 * (аппаратный, качество близкое, но нужен драйвер NVIDIA) → libopenh264
 * (программный, без CRF, задаём битрейт с запасом).
 */
const H264 = [
  { name: 'libx264', args: ['-profile:v', 'high', '-preset', 'slow', '-crf', '18'] },
  { name: 'h264_nvenc', args: ['-profile:v', 'high', '-preset', 'p6', '-rc', 'vbr', '-cq', '19', '-b:v', '0'] },
  { name: 'libopenh264', args: ['-profile:v', 'high', '-b:v', '14M'] },
];

let ffmpegCache = null;

/** Ищет ffmpeg и заодно решает, каким кодировщиком он умеет писать H.264. */
function pickFfmpeg() {
  if (ffmpegCache) return ffmpegCache;

  const candidates = [];
  if (process.env.FFMPEG) {
    if (!existsSync(process.env.FFMPEG)) throw new Error(`FFMPEG=${process.env.FFMPEG}: файла нет`);
    candidates.push(process.env.FFMPEG);
  }
  const local = process.env.LOCALAPPDATA ?? '';
  const home = process.env.USERPROFILE ?? '';
  candidates.push(
    'C:/ffmpeg/bin/ffmpeg.exe',
    'C:/ProgramData/chocolatey/bin/ffmpeg.exe',
    local && join(local, 'Microsoft/WinGet/Links/ffmpeg.exe'),
    home && join(home, 'scoop/shims/ffmpeg.exe'),
    // Сборки, которые кладут рядом с собой другие программы. Полноценный
    // ffmpeg, просто не в PATH.
    'C:/Program Files (x86)/MOZA Pit House/bin/ffmpeg.exe',
    'C:/Program Files/Krita (x64)/bin/ffmpeg.exe',
    'ffmpeg',
  );

  let fallback = null;
  for (const path of candidates.filter(Boolean)) {
    if (path !== 'ffmpeg' && !existsSync(path)) continue;
    let list;
    try {
      list = execFileSync(path, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      continue;
    }
    for (const codec of H264) {
      if (!list.includes(codec.name)) continue;
      const found = { path, codec };
      // Первый в списке предпочтений — берём сразу; иначе запоминаем и смотрим,
      // не найдётся ли дальше сборка получше.
      if (codec === H264[0]) return (ffmpegCache = found);
      if (!fallback || H264.indexOf(codec) < H264.indexOf(fallback.codec)) fallback = found;
    }
  }
  if (fallback) return (ffmpegCache = fallback);
  throw new Error(
    'не нашёл ffmpeg с кодировщиком H.264. Укажи путь: FFMPEG="C:/путь/к/ffmpeg.exe" npm run ...',
  );
}

/** Аргументы кодировщика H.264 для найденной сборки. */
export function h264Args() {
  const { codec } = pickFfmpeg();
  return ['-c:v', codec.name, ...codec.args];
}

/** Имя выбранного кодировщика — для отчёта в консоль. */
export function h264Name() {
  return pickFfmpeg().codec.name;
}

/**
 * Путь к браузеру для puppeteer-core. Раньше он был захардкожен в каждом
 * скрипте одной и той же строкой — на машине без Chrome в этом месте падали
 * разом все проверки, включая verify-moderation.
 *
 * Порядок: переменная окружения CHROME (годится и для Chromium, и для Edge),
 * затем обычные места установки. Движок один и тот же, так что для проверки
 * вёрстки и обрезки Edge равноценен Chrome.
 */
export function chromePath() {
  if (process.env.CHROME) {
    if (!existsSync(process.env.CHROME)) throw new Error(`CHROME=${process.env.CHROME}: файла нет`);
    return process.env.CHROME;
  }
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    local && join(local, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'браузер не найден. Укажи путь: CHROME="C:/путь/к/chrome.exe" npm run ... — ' +
      `искали: ${candidates.join(', ')}`,
    );
  }
  return found;
}

export const DATA = join(ROOT, 'public', 'data');

/**
 * Игры для промо-материалов: известные, с чистыми кадрами — без крови, чужих
 * плашек и логотипов магазинов. Промо-кадры и ролики снимаются только по ним:
 * случайный кадр из тысячи уже приносил на карточку «Steam Edition» и
 * «Community Contributor». Отобраны глазами по контактному листу 17.09.2026.
 */
export const PROMO_GAMES = [
  'stardew-valley', 'terraria', 'hollow-knight', 'rocket-league', 'euro-truck-simulator-2',
  'cities-skylines', 'hogwarts-legacy', 'rust', 'fall-guys-ultimate-knockout', 'apex-legends',
  'valheim', 'kerbal-space-program', 'the-sims-4', 'forza-horizon-5', 'hades', 'stray',
  'it-takes-two', 'overcooked-2', 'human-fall-flat', 'raft', 'monster-hunter-world', 'elden-ring',
  'portal', 'portal-2', 'baldurs-gate-3', 'warframe', 'no-mans-sky',
  'the-elder-scrolls-v-skyrim-special-edition', 'fallout-4', 'oxygen-not-included', 'war-thunder',
  'pubg-battlegrounds', 'deep-rock-galactic', 'beat-saber', 'dead-cells', 'ori-and-the-will-of-the-wisps',
  'factorio', 'garrys-mod', 'half-life-2',
];

/** Тело data/bundle.json, урезанное до игр из PROMO_GAMES. */
export async function promoBundleBody() {
  const raw = JSON.parse(await readFile(join(DATA, 'bundle.json'), 'utf8'));
  const keep = new Set(PROMO_GAMES);
  return JSON.stringify({
    v: raw.v,
    games: raw.games.filter((g) => keep.has(g[0])),
    icons: raw.icons.filter((r) => keep.has(r[0])),
    shots: raw.shots.filter((r) => keep.has(r[0])),
  });
}

/**
 * Отвечает на запрос data/bundle.json урезанным набором. true — запрос был за
 * данными и ответ отдан; false — пусть обработчик решает сам.
 */
export function respondPromoBundle(req, body) {
  if (new URL(req.url()).pathname !== '/data/bundle.json') return false;
  req.respond({ status: 200, contentType: 'application/json; charset=utf-8', body });
  return true;
}
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
