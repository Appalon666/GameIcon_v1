/**
 * Дополняет games.json новыми играми глубже по SteamSpy (не перезатирает
 * существующие). После этого нужно догнать shots/icons и почистить иконки:
 *
 *   node scripts/add-games.mjs --count 500
 *   npm run shots         # скриншоты для новых
 *   npm run icons         # иконки для новых (существующие не трогает)
 *   python scripts/ocr-icons.py
 *   node scripts/drop-name-icons.mjs   # убрать новые иконки с названием
 *   npm run optimize && npm run build && npm run pack
 *
 * Тиры пересчитываются по квантилям популярности на всём наборе.
 *
 * Флаги:
 *   --count N   сколько новых игр добавить (по умолчанию 500)
 *   --pages K   сколько страниц SteamSpy просмотреть (по умолчанию 6, ~6000 игр)
 *   --delay MS  пауза между appdetails (по умолчанию 1100)
 */
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { CACHE, DATA, getJSON, sleep, slug, writeJSON, readJSON } from './lib.mjs';
import { classifyGenre, ownersMid } from './genres.mjs';

const args = process.argv.slice(2);
const num = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const COUNT = num('--count', 500);
const PAGES = num('--pages', 6);
const DELAY = num('--delay', 1100);

const SS_CACHE = join(CACHE, 'ss');
const CUT = [0.12, 0.35, 0.65, 1];
const JUNK = /soundtrack|\bdlc\b|\bost\b|artbook|wallpaper engine|demo\b|\bbeta\b|season pass|art of\b/i;
const NON_GAME = /utilities|software|web publishing|animation|design|video production|audio production|photo editing|education/i;

async function ssDetails(appid) {
  const cached = join(SS_CACHE, `${appid}.json`);
  const hit = await readJSON(cached);
  if (hit) return { data: hit, cached: true };
  const data = await getJSON(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`);
  await mkdir(SS_CACHE, { recursive: true });
  await writeFile(cached, JSON.stringify(data));
  return { data, cached: false };
}

function orderedTags(tags) {
  if (!tags || Array.isArray(tags)) return [];
  return Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

async function main() {
  const gamesDoc = await readJSON(join(DATA, 'games.json'));
  const have = gamesDoc.games;
  const haveAppids = new Set(have.map((g) => g.appid));
  const haveIds = new Set(have.map((g) => g.id));
  console.log(`[add] сейчас ${have.length} игр, добавляю ещё ${COUNT}`);

  // Собираем кандидатов со страниц по убыванию популярности, исключая уже
  // имеющиеся.
  const seen = new Map();
  for (let p = 0; p < PAGES; p++) {
    const page = await getJSON(`https://steamspy.com/api.php?request=all&page=${p}`);
    for (const c of Object.values(page)) {
      if (!haveAppids.has(c.appid) && !seen.has(c.appid)) seen.set(c.appid, c);
    }
  }
  const candidates = [...seen.values()]
    .filter((c) => c.name && !JUNK.test(c.name))
    .sort((a, b) => ownersMid(b.owners) - ownersMid(a.owners));
  console.log(`[add] кандидатов на просмотр: ${candidates.length}`);

  const added = [];
  let scanned = 0;
  for (const c of candidates) {
    if (added.length >= COUNT) break;
    scanned++;
    let det;
    try {
      const r = await ssDetails(c.appid);
      det = r.data;
      if (!r.cached) await sleep(DELAY);
    } catch {
      continue;
    }
    if (NON_GAME.test(det.genre || '')) continue;
    const genre = classifyGenre(det.genre || '', orderedTags(det.tags));
    if (!genre) continue;

    let id = slug(c.name);
    while (haveIds.has(id) || added.some((g) => g.id === id)) id += '-x';

    added.push({
      id,
      name: c.name,
      genre,
      tier: 3,
      appid: c.appid,
      developer: det.developer || c.developer || '',
      owners: ownersMid(c.owners),
      fact: '',
    });
    if (added.length % 25 === 0) console.log(`[add] ${added.length}/${COUNT} (просмотрено ${scanned})`);
  }

  gamesDoc.games.push(...added);
  // Пересчёт тиров по квантилям на всём наборе.
  gamesDoc.games.sort((a, b) => (b.owners ?? 0) - (a.owners ?? 0));
  gamesDoc.games.forEach((g, i) => {
    const q = (i + 1) / gamesDoc.games.length;
    g.tier = CUT.findIndex((cc) => q <= cc) + 1;
  });
  gamesDoc.count = gamesDoc.games.length;
  await writeJSON(join(DATA, 'games.json'), gamesDoc);

  const byTier = {};
  for (const g of gamesDoc.games) byTier[g.tier] = (byTier[g.tier] || 0) + 1;
  console.log(`\n[add] добавлено ${added.length} игр, всего ${gamesDoc.count}`);
  console.log('[add] тиры:', byTier);
  console.log('[add] дальше: npm run shots, npm run icons, python scripts/ocr-icons.py, node scripts/drop-name-icons.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
