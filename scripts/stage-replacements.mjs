/**
 * Шаг 1 чистки иконок: убирает иконки с названием (по scripts/.cache/ocr.json)
 * и набирает КАНДИДАТОВ на замену — новые игры глубже по SteamSpy, у которых
 * есть иконка. Иконки кандидатов качаются в staging (public/img/icons_stage/),
 * а их чистоту (нет ли названия) проверит потом OCR — scripts/ocr-stage.py.
 *
 * Меняет только иконки. Скриншоты и shots.json не трогаются.
 *
 * Итог: обрезанный icons.json (без названий) + scripts/.cache/stage.json.
 */
import { join } from 'node:path';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { CACHE, DATA, IMG, download, getJSON, readJSON, sleep, slug, writeJSON } from './lib.mjs';
import { classifyGenre, ownersMid } from './genres.mjs';

const SS_CACHE = join(CACHE, 'ss');
const STAGE_DIR = join(IMG, 'icons_stage');
const ICONS_DIR = join(IMG, 'icons');
const JUNK = /soundtrack|\bdlc\b|\bost\b|artbook|wallpaper engine|demo\b|\bbeta\b|season pass|art of\b/i;
const NON_GAME = /utilities|software|web publishing|animation|design|video production|audio production|photo editing|education/i;

const KEY = (await readFile(join(CACHE, '..', '..', '.env'), 'utf8').catch(() => ''))
  .match(/^SGDB_KEY=(.+)$/m)?.[1]?.trim();
const auth = { headers: [`Authorization: Bearer ${KEY}`] };

async function ssDetails(appid) {
  const cached = join(SS_CACHE, `${appid}.json`);
  const hit = await readJSON(cached);
  if (hit) return { data: hit, cached: true };
  const data = await getJSON(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`);
  await mkdir(SS_CACHE, { recursive: true });
  await writeJSON(cached, data);
  return { data, cached: false };
}

function orderedTags(tags) {
  if (!tags || Array.isArray(tags)) return [];
  return Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

async function sgdbIcon(appid) {
  const base = `https://www.steamgriddb.com/api/v2/icons/steam/${appid}`;
  for (const q of ['?styles=official&types=static', '?types=static', '']) {
    try {
      const res = await getJSON(base + q, auth);
      const ok = (res?.data ?? []).filter((i) => !i.nsfw && !i.humor && i.thumb);
      if (ok.length) return ok[0];
    } catch (e) {
      if (String(e.message).includes('404')) return null;
    }
  }
  return null;
}

async function main() {
  const gamesDoc = await readJSON(join(DATA, 'games.json'));
  const iconsDoc = await readJSON(join(DATA, 'icons.json'));
  const ocr = await readJSON(join(CACHE, 'ocr.json'));
  if (!gamesDoc || !iconsDoc || !ocr) {
    console.error('нужны games.json, icons.json и scripts/.cache/ocr.json');
    process.exit(1);
  }

  // 1. Убираем иконки с названием.
  const drop = new Set(ocr.filter((x) => x.name_shown).map((x) => x.file));
  const keptIcons = [];
  for (const it of iconsDoc.icons) {
    if (drop.has(it.file)) {
      await rm(join(ICONS_DIR, it.file)).catch(() => {});
    } else {
      keptIcons.push(it);
    }
  }
  const removed = iconsDoc.icons.length - keptIcons.length;
  iconsDoc.icons = keptIcons;
  iconsDoc.count = keptIcons.length;
  await writeJSON(join(DATA, 'icons.json'), iconsDoc);
  console.log(`[stage] убрано иконок с названием: ${removed}, осталось ${keptIcons.length}`);

  // 2. Набираем кандидатов на замену. Нужно ~removed чистых, но часть отсеет
  //    OCR — набираем с запасом.
  const need = removed;
  const stageTarget = Math.ceil(need * 2.2);
  const haveAppids = new Set(gamesDoc.games.map((g) => g.appid));
  const haveIds = new Set(gamesDoc.games.map((g) => g.id));

  console.log(`[stage] цель кандидатов: ${stageTarget} (нужно чистых ~${need})`);
  await rm(STAGE_DIR, { recursive: true, force: true }).catch(() => {});
  await mkdir(STAGE_DIR, { recursive: true });

  const pages = [
    await getJSON('https://steamspy.com/api.php?request=all&page=0'),
    await getJSON('https://steamspy.com/api.php?request=all&page=1'),
  ];
  const candidates = pages
    .flatMap((p) => Object.values(p))
    .filter((c) => c.name && !haveAppids.has(c.appid) && !JUNK.test(c.name))
    .sort((a, b) => ownersMid(b.owners) - ownersMid(a.owners));

  const staged = [];
  let scanned = 0;
  for (const c of candidates) {
    if (staged.length >= stageTarget) break;
    scanned++;
    let det;
    try {
      const r = await ssDetails(c.appid);
      det = r.data;
      if (!r.cached) await sleep(1100);
    } catch {
      continue;
    }
    if (NON_GAME.test(det.genre || '')) continue;
    const genre = classifyGenre(det.genre || '', orderedTags(det.tags));
    if (!genre) continue;

    let id = slug(c.name);
    while (haveIds.has(id) || staged.some((s) => s.id === id)) id += '-x';

    const icon = await sgdbIcon(c.appid);
    await sleep(300);
    if (!icon) continue;
    const file = `${id}.png`;
    try {
      await download(icon.thumb, join(STAGE_DIR, file));
    } catch {
      continue;
    }

    staged.push({
      id,
      name: c.name,
      genre,
      appid: c.appid,
      developer: det.developer || c.developer || '',
      owners: ownersMid(c.owners),
      source: icon.url,
      author: icon.author?.name ?? '',
      file,
    });
    if (staged.length % 20 === 0) console.log(`[stage] кандидатов ${staged.length}/${stageTarget} (просмотрено ${scanned})`);
  }

  await writeJSON(join(CACHE, 'stage.json'), { need, staged });
  console.log(`\n[stage] готово: ${staged.length} кандидатов в staging → scripts/.cache/stage.json`);
  console.log('[stage] дальше: python scripts/ocr-stage.py, затем node scripts/finalize-replacements.mjs');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
