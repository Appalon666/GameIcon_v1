/**
 * Проверка целостности данных перед публикацией. Ничего не генерирует —
 * данные собраны пайплайном (meta/shots/icons); здесь только сверка и сводка.
 *
 *   - каждая иконка/скриншот ссылается на существующую игру;
 *   - файл картинки лежит на диске;
 *   - хватает игр с иконками и со скриншотами на полноценный вопрос;
 *   - сводка по тирам, жанрам и весу.
 *
 * Ненулевой код выхода — если есть битые ссылки: тогда паковать нельзя.
 */
import { join } from 'node:path';
import { access, stat, readdir } from 'node:fs/promises';
import { DATA, IMG, readJSON } from './lib.mjs';

const OPTIONS = 4;
const exists = (p) => access(p).then(() => true).catch(() => false);

async function dirSize(dir) {
  let total = 0;
  for (const name of await readdir(dir).catch(() => [])) {
    total += (await stat(join(dir, name))).size;
  }
  return total;
}

const mb = (b) => (b / 1024 / 1024).toFixed(1);

async function main() {
  const games = (await readJSON(join(DATA, 'games.json')))?.games ?? [];
  const icons = (await readJSON(join(DATA, 'icons.json')))?.icons ?? [];
  const shots = (await readJSON(join(DATA, 'shots.json')))?.shots ?? [];
  const gameById = new Map(games.map((g) => [g.id, g]));

  let errors = 0;
  let missingFiles = 0;
  const orphanGenre = [];

  const check = async (list, kind, dir) => {
    let playable = 0;
    for (const it of list) {
      if (!gameById.has(it.gameId)) {
        console.error(`[build] ${kind} ${it.file}: нет игры ${it.gameId}`);
        errors++;
        continue;
      }
      if (!(await exists(join(dir, it.file)))) {
        missingFiles++;
        if (missingFiles <= 10) console.error(`[build] ${kind}: нет файла ${it.file}`);
        errors++;
        continue;
      }
      if ((it.blur?.length || it.clean) && !it.skip) playable++;
    }
    return playable;
  };

  const iconsPlayable = await check(icons, 'icon', join(IMG, 'icons'));
  const shotsPlayable = await check(shots, 'shot', join(IMG, 'shots'));

  // Игр достаточно для вариантов ответа?
  const iconGames = new Set(icons.filter((i) => (i.blur?.length || i.clean) && !i.skip).map((i) => i.gameId));
  const shotGames = new Set(shots.filter((s) => (s.blur?.length || s.clean) && !s.skip).map((s) => s.gameId));
  if (iconGames.size && iconGames.size < OPTIONS) { console.error(`[build] мало игр с иконками: ${iconGames.size}`); errors++; }
  if (shotGames.size && shotGames.size < OPTIONS) { console.error(`[build] мало игр со скриншотами: ${shotGames.size}`); errors++; }

  for (const g of games) if (!g.genre) orphanGenre.push(g.id);

  const byTier = {};
  const byGenre = {};
  for (const g of games) {
    byTier[g.tier] = (byTier[g.tier] || 0) + 1;
    byGenre[g.genre] = (byGenre[g.genre] || 0) + 1;
  }

  const size = (await dirSize(join(IMG, 'icons'))) + (await dirSize(join(IMG, 'shots')));

  console.log('\n=== Сводка ===');
  console.log(`игр: ${games.length}`);
  console.log(`иконок: ${icons.length} (играбельных ${iconsPlayable}, игр ${iconGames.size})`);
  console.log(`скриншотов: ${shots.length} (играбельных ${shotsPlayable}, игр ${shotGames.size})`);
  console.log('тиры:', byTier);
  console.log('жанры:', byGenre);
  console.log(`картинки на диске: ${mb(size)} МБ`);
  if (orphanGenre.length) console.log(`без жанра: ${orphanGenre.length}`);

  if (errors) {
    console.error(`\n[build] ОШИБОК: ${errors}${missingFiles ? ` (нет файлов: ${missingFiles})` : ''} — паковать нельзя`);
    process.exit(1);
  }
  console.log('\n[build] данные целостны ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
