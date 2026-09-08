/**
 * Собирает список игр для викторины из SteamSpy (без ключа).
 *
 *   1. `request=all` — топ игр по числу владельцев (1000 на страницу).
 *   2. по каждой `request=appdetails` — жанр, теги, разработчик.
 *   3. жанр приводим к набору викторины, тир считаем по числу владельцев.
 *
 * Результат — public/data/games.json. Сырые ответы кэшируются в
 * scripts/.cache/ss/, поэтому повторный запуск идёт мгновенно и его можно
 * прервать и продолжить.
 *
 * Флаги:
 *   --limit N     сколько игр оставить в итоге (по умолчанию 500)
 *   --scan N      сколько кандидатов просмотреть (по умолчанию limit + 250)
 *   --delay MS    пауза между запросами appdetails (по умолчанию 1200)
 */
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CACHE, DATA, getJSON, sleep, slug, writeJSON } from './lib.mjs';
import { classifyGenre, ownersMid } from './genres.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const LIMIT = flag('--limit', 500);
const SCAN = flag('--scan', LIMIT + 250);
const DELAY = flag('--delay', 1200);

const SS_CACHE = join(CACHE, 'ss');

/** Пропускаем неигровое и мусор по названию. */
const JUNK = /soundtrack|\bdlc\b|\bost\b|artbook|wallpaper engine|demo\b|\bbeta\b|season pass|art of\b/i;
const NON_GAME_GENRE = /utilities|software|web publishing|animation|design|video production|audio production|photo editing|education/i;

async function ssAppDetails(appid) {
  const cached = join(SS_CACHE, `${appid}.json`);
  try {
    return JSON.parse(await readFile(cached, 'utf8'));
  } catch {
    /* нет в кэше — качаем */
  }
  const data = await getJSON(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`);
  await mkdir(SS_CACHE, { recursive: true });
  await writeFile(cached, JSON.stringify(data));
  return data;
}

/** Теги SteamSpy ({тег: голоса}) → массив тегов по убыванию голосов. */
function orderedTags(tags) {
  if (!tags || Array.isArray(tags)) return [];
  return Object.entries(tags)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

async function main() {
  console.log(`[meta] беру топ игр SteamSpy, цель — ${LIMIT} игр (просмотр до ${SCAN})`);
  const page = await getJSON('https://steamspy.com/api.php?request=all&page=0');
  const candidates = Object.values(page)
    .sort((a, b) => ownersMid(b.owners) - ownersMid(a.owners))
    .slice(0, SCAN);
  console.log(`[meta] кандидатов: ${candidates.length}`);

  const games = [];
  const usedIds = new Set();
  let scanned = 0;
  let fromCache = 0;

  for (const c of candidates) {
    if (games.length >= LIMIT) break;
    scanned++;
    if (!c.name || JUNK.test(c.name)) continue;

    let det;
    const had = await readFile(join(SS_CACHE, `${c.appid}.json`), 'utf8').then(() => true).catch(() => false);
    try {
      det = await ssAppDetails(c.appid);
      if (had) fromCache++;
      else await sleep(DELAY);
    } catch (e) {
      console.warn(`[meta] ${c.appid} ${c.name}: ${e.message}`);
      await sleep(DELAY);
      continue;
    }

    const genreRaw = det.genre || '';
    if (NON_GAME_GENRE.test(genreRaw)) continue;
    const tags = orderedTags(det.tags);
    const genre = classifyGenre(genreRaw, tags);
    if (!genre) continue; // не смогли отнести к жанру — пропускаем

    let id = slug(c.name);
    while (usedIds.has(id)) id += '-x';
    usedIds.add(id);

    const mid = ownersMid(c.owners);
    games.push({
      id,
      name: c.name,
      genre,
      tier: 3, // перекроем по квантилям после сбора
      appid: c.appid,
      developer: det.developer || c.developer || '',
      owners: mid,
      fact: '',
    });

    if (games.length % 25 === 0) {
      console.log(`[meta] ${games.length}/${LIMIT} (просмотрено ${scanned}, из кэша ${fromCache})`);
    }
  }

  games.sort((a, b) => b.owners - a.owners);

  // Тир по квантилям популярности, а не по абсолютным владельцам: в топ-500
  // Steam даже «менее известные» игры имеют миллионы владельцев, и абсолютные
  // пороги оставили бы 4-й тир пустым. Ранг же гарантирует спред 1→4, а значит
  // рабочую кривую сложности. Границы: 12% / 35% / 65% / 100%.
  const CUT = [0.12, 0.35, 0.65, 1];
  games.forEach((g, i) => {
    const q = (i + 1) / games.length;
    g.tier = CUT.findIndex((c) => q <= c) + 1;
  });

  // Небольшая сводка по жанрам и тирам — удобно оценить баланс.
  const by = (key) => {
    const m = {};
    for (const g of games) m[g[key]] = (m[g[key]] || 0) + 1;
    return m;
  };

  await writeJSON(join(DATA, 'games.json'), {
    generatedAt: new Date().toISOString(),
    count: games.length,
    games,
  });

  console.log(`\n[meta] готово: ${games.length} игр → public/data/games.json`);
  console.log('[meta] по тирам:', by('tier'));
  console.log('[meta] по жанрам:', by('genre'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
