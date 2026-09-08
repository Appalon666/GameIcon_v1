/**
 * Качает скриншоты игр из Steam Store (без ключа) для режима «Скриншоты».
 *
 *   1. по каждой игре из games.json — Steam Store appdetails
 *   2. берём первые N скриншотов (path_thumbnail ~600px), скачиваем
 *   3. заодно вытаскиваем год выхода и дополняем им games.json
 *
 * Результат — public/data/shots.json + public/img/shots/*.jpg.
 * Скриншоты по умолчанию помечены clean=true (названия игры на них обычно нет),
 * поэтому режим играбелен сразу; редактор нужен только чтобы закрасить редкие
 * кадры с логотипом/названием или забраковать неудачные.
 *
 * Флаги:
 *   --per N     сколько скриншотов на игру (по умолчанию 1 — держим объём малым)
 *   --delay MS  пауза между запросами (по умолчанию 1600, Steam троттлит)
 *   --force     перекачать уже существующие файлы
 */
import { join } from 'node:path';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { CACHE, DATA, IMG, download, getJSON, readJSON, sleep, writeJSON } from './lib.mjs';

const args = process.argv.slice(2);
const num = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const PER = num('--per', 1);
const DELAY = num('--delay', 1600);
const FORCE = args.includes('--force');

const STORE_CACHE = join(CACHE, 'store');
const SHOTS_DIR = join(IMG, 'shots');

const exists = (p) => access(p).then(() => true).catch(() => false);

async function storeDetails(appid) {
  const cached = join(STORE_CACHE, `${appid}.json`);
  const hit = await readJSON(cached);
  if (hit) return hit;
  const data = await getJSON(
    `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`,
  );
  await mkdir(STORE_CACHE, { recursive: true });
  await writeFile(cached, JSON.stringify(data));
  return data;
}

function yearOf(rel) {
  const m = String(rel?.date || '').match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

async function main() {
  const gamesDoc = await readJSON(join(DATA, 'games.json'));
  if (!gamesDoc?.games?.length) {
    console.error('[shots] нет games.json — сначала npm run meta');
    process.exit(1);
  }
  const games = gamesDoc.games;
  console.log(`[shots] игр: ${games.length}, по ${PER} скриншота на игру`);

  const shots = [];
  let done = 0;
  let skipped = 0;

  for (const g of games) {
    done++;
    let det;
    const cachedPath = join(STORE_CACHE, `${g.appid}.json`);
    const wasCached = await exists(cachedPath);
    try {
      det = await storeDetails(g.appid);
      if (!wasCached) await sleep(DELAY);
    } catch (e) {
      console.warn(`[shots] ${g.appid} ${g.name}: ${e.message}`);
      await sleep(DELAY);
      continue;
    }

    const entry = det?.[g.appid];
    if (!entry?.success || entry.data?.type !== 'game') {
      skipped++;
      continue;
    }
    const data = entry.data;
    const year = yearOf(data.release_date);
    if (year) g.year = year;

    const list = (data.screenshots ?? []).slice(0, PER);
    let idx = 0;
    for (const s of list) {
      idx++;
      const file = `${g.id}-${idx}.jpg`;
      const dest = join(SHOTS_DIR, file);
      const url = s.path_thumbnail || s.path_full;
      if (!url) continue;
      try {
        if (FORCE || !(await exists(dest))) await download(url, dest);
        shots.push({
          file,
          gameId: g.id,
          kind: 'shot',
          source: `https://store.steampowered.com/app/${g.appid}`,
          blur: [],
          clean: true,
        });
      } catch (e) {
        console.warn(`[shots] ${file}: ${e.message}`);
      }
    }

    if (done % 25 === 0) console.log(`[shots] ${done}/${games.length}, скриншотов ${shots.length}`);
  }

  await writeJSON(join(DATA, 'shots.json'), {
    generatedAt: new Date().toISOString(),
    count: shots.length,
    shots,
  });
  // Дополнили games.json годами выхода — перезаписываем.
  await writeJSON(join(DATA, 'games.json'), gamesDoc);

  console.log(`\n[shots] готово: ${shots.length} скриншотов у ${games.length - skipped} игр`);
  if (skipped) console.log(`[shots] без данных Store: ${skipped} (делистинг/регион)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
