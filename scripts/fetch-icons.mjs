/**
 * Качает квадратные ярлыки-иконки игр из SteamGridDB (нужен ключ SGDB_KEY).
 *
 *   1. по каждой игре из games.json — /icons/steam/{appid}
 *   2. выбираем лучшую иконку (официальный стиль, без NSFW/юмора)
 *   3. качаем PNG 256×256 (поле thumb — единый размер, без пересжатия)
 *
 * Результат — public/data/icons.json + public/img/icons/*.png.
 * Иконки помечаем clean=false и needsReview=true: на многих есть название игры,
 * его нужно закрасить в редакторе (tools/blur-editor.html). До разметки иконка
 * в игру не попадает — иначе название спойлерило бы ответ.
 *
 * Флаги:
 *   --delay MS  пауза между запросами (по умолчанию 400)
 *   --force     перекачать уже существующие файлы
 *   --clean     пометить новые иконки сразу играбельными (clean=true), без разметки
 */
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { CACHE, DATA, IMG, download, getJSON, readJSON, sleep, writeJSON } from './lib.mjs';

const args = process.argv.slice(2);
const num = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const DELAY = num('--delay', 400);
const FORCE = args.includes('--force');
const DEFAULT_CLEAN = args.includes('--clean');

const KEY = await readKey();
const ICONS_DIR = join(IMG, 'icons');
const exists = (p) => access(p).then(() => true).catch(() => false);

async function readKey() {
  const env = await readFile(join(CACHE, '..', '..', '.env'), 'utf8').catch(() => '');
  const m = env.match(/^SGDB_KEY=(.+)$/m);
  const key = (process.env.SGDB_KEY || m?.[1] || '').trim();
  if (!key) {
    console.error('[icons] нет ключа SGDB_KEY. Положи его в .env (см. .env.example)');
    process.exit(1);
  }
  return key;
}

const auth = { headers: [`Authorization: Bearer ${KEY}`] };

/** Иконки игры по Steam appid. Сначала официальные, потом любые. */
async function iconsFor(appid) {
  const base = `https://www.steamgriddb.com/api/v2/icons/steam/${appid}`;
  for (const q of ['?styles=official&types=static', '?types=static', '']) {
    try {
      const res = await getJSON(base + q, auth);
      if (res?.success && res.data?.length) return res.data;
    } catch (e) {
      if (String(e.message).includes('404')) return [];
    }
  }
  return [];
}

/** Выбирает пригодную иконку: не NSFW/юмор, есть PNG-превью. */
function pickIcon(list) {
  // Берём только записи с thumb: это всегда PNG 256×256. Поле url бывает .ico
  // или .png произвольного размера — сохранять его под именем .png неправильно.
  const ok = list.filter((i) => !i.nsfw && !i.humor && i.thumb);
  // SteamGridDB отдаёт по убыванию популярности/качества — берём первую.
  return ok[0] ?? null;
}

async function main() {
  const gamesDoc = await readJSON(join(DATA, 'games.json'));
  if (!gamesDoc?.games?.length) {
    console.error('[icons] нет games.json — сначала npm run meta');
    process.exit(1);
  }
  const games = gamesDoc.games;
  // Что уже размечено — не трогаем: сохраняем blur/clean/skip из прошлого icons.json.
  const prev = (await readJSON(join(DATA, 'icons.json')))?.icons ?? [];
  const prevById = new Map(prev.map((i) => [i.gameId, i]));

  console.log(`[icons] игр: ${games.length}`);
  const icons = [];
  let got = 0;
  let miss = 0;

  for (const [n, g] of games.entries()) {
    const file = `${g.id}.png`;
    const dest = join(ICONS_DIR, file);
    const old = prevById.get(g.id);

    let chosen = null;
    if (!old || FORCE || !(await exists(dest))) {
      try {
        chosen = pickIcon(await iconsFor(g.appid));
        await sleep(DELAY);
      } catch (e) {
        console.warn(`[icons] ${g.appid} ${g.name}: ${e.message}`);
        await sleep(DELAY);
      }
      if (chosen) {
        try {
          // Картинку тянем с публичного CDN — БЕЗ заголовка авторизации:
          // на Bearer к CDN SteamGridDB отвечает 401.
          await download(chosen.thumb, dest);
        } catch (e) {
          console.warn(`[icons] download ${file}: ${e.message}`);
          chosen = null;
        }
      }
    } else {
      chosen = true; // файл уже есть, метаданные берём из old
    }

    if (!chosen && !old) {
      miss++;
      continue;
    }
    got++;

    icons.push({
      file,
      gameId: g.id,
      kind: 'icon',
      source: chosen && chosen !== true ? chosen.url : old?.source ?? '',
      author: chosen && chosen !== true ? chosen.author?.name ?? '' : old?.author ?? '',
      // Ручную разметку из прошлого запуска сохраняем.
      blur: old?.blur ?? [],
      clean: old?.clean ?? DEFAULT_CLEAN,
      needsReview: old ? old.needsReview ?? false : !DEFAULT_CLEAN,
      skip: old?.skip ?? false,
    });

    if ((n + 1) % 25 === 0) console.log(`[icons] ${n + 1}/${games.length}, найдено ${got}`);
  }

  await writeJSON(join(DATA, 'icons.json'), {
    generatedAt: new Date().toISOString(),
    count: icons.length,
    icons,
  });

  console.log(`\n[icons] готово: ${got} иконок → public/data/icons.json`);
  if (miss) console.log(`[icons] без иконки на SteamGridDB: ${miss}`);
  const review = icons.filter((i) => !i.clean && !i.blur.length).length;
  if (review) console.log(`[icons] ждут разметки названия: ${review} (tools/blur-editor.html)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
