/**
 * Шаг 3 чистки иконок: вклеивает чистые (без названия) иконки-кандидаты вместо
 * убранных. Читает scripts/.cache/stage.json + stage_ocr.json.
 *
 *   - берёт чистых кандидатов по порядку (по популярности) до нужного числа;
 *   - переносит иконки из staging в public/img/icons/;
 *   - добавляет игры в games.json и записи в icons.json;
 *   - подтягивает год выхода из Steam Store;
 *   - пересчитывает тиры по квантилям популярности на всём наборе.
 *
 * Меняет только иконки и games.json (общий список игр). shots.json не трогается.
 */
import { join } from 'node:path';
import { rename, rm, mkdir, writeFile } from 'node:fs/promises';
import { CACHE, DATA, IMG, getJSON, readJSON, sleep, writeJSON } from './lib.mjs';

const STAGE_DIR = join(IMG, 'icons_stage');
const ICONS_DIR = join(IMG, 'icons');
const STORE_CACHE = join(CACHE, 'store');
const CUT = [0.12, 0.35, 0.65, 1];

async function storeYear(appid) {
  const cached = join(STORE_CACHE, `${appid}.json`);
  let doc = await readJSON(cached);
  if (!doc) {
    try {
      doc = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`);
      await mkdir(STORE_CACHE, { recursive: true });
      await writeFile(cached, JSON.stringify(doc));
      await sleep(1600);
    } catch {
      return null;
    }
  }
  const m = String(doc?.[appid]?.data?.release_date?.date || '').match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

async function main() {
  const gamesDoc = await readJSON(join(DATA, 'games.json'));
  const iconsDoc = await readJSON(join(DATA, 'icons.json'));
  const stage = await readJSON(join(CACHE, 'stage.json'));
  const stageOcr = await readJSON(join(CACHE, 'stage_ocr.json'));
  if (!stage || !stageOcr) {
    console.error('нужны stage.json и stage_ocr.json (сначала stage + ocr-stage.py)');
    process.exit(1);
  }

  const cleanIds = new Set(stageOcr.filter((s) => s.clean).map((s) => s.id));
  const cleanStaged = stage.staged.filter((s) => cleanIds.has(s.id));
  const accepted = cleanStaged.slice(0, stage.need);
  const rejected = stage.staged.filter((s) => !accepted.includes(s));

  console.log(`[final] нужно ${stage.need}, чистых кандидатов ${cleanStaged.length}, берём ${accepted.length}`);

  let year = 0;
  for (const s of accepted) {
    await rename(join(STAGE_DIR, s.file), join(ICONS_DIR, s.file)).catch(() => {});
    const y = await storeYear(s.appid);
    const game = {
      id: s.id,
      name: s.name,
      genre: s.genre,
      tier: 3,
      appid: s.appid,
      developer: s.developer,
      owners: s.owners,
      fact: '',
    };
    if (y) {
      game.year = y;
      year++;
    }
    gamesDoc.games.push(game);
    iconsDoc.icons.push({
      file: s.file,
      gameId: s.id,
      kind: 'icon',
      source: s.source,
      author: s.author,
      blur: [],
      clean: true,
      needsReview: false,
      skip: false,
    });
  }

  // Пересчёт тиров по квантилям популярности на всём наборе.
  gamesDoc.games.sort((a, b) => (b.owners ?? 0) - (a.owners ?? 0));
  gamesDoc.games.forEach((g, i) => {
    const q = (i + 1) / gamesDoc.games.length;
    g.tier = CUT.findIndex((c) => q <= c) + 1;
  });

  gamesDoc.count = gamesDoc.games.length;
  iconsDoc.count = iconsDoc.icons.length;
  await writeJSON(join(DATA, 'games.json'), gamesDoc);
  await writeJSON(join(DATA, 'icons.json'), iconsDoc);

  // Чистим staging и отвергнутые файлы.
  await rm(STAGE_DIR, { recursive: true, force: true }).catch(() => {});

  const byTier = {};
  for (const g of gamesDoc.games) byTier[g.tier] = (byTier[g.tier] || 0) + 1;
  console.log(`[final] добавлено игр: ${accepted.length} (год у ${year})`);
  console.log(`[final] games.json: ${gamesDoc.count} игр | icons.json: ${iconsDoc.count} иконок`);
  console.log('[final] тиры:', byTier);
  if (rejected.length) console.log(`[final] отвергнуто кандидатов (текст/лишние): ${rejected.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
