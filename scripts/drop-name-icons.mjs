/**
 * Убирает из режима иконок все иконки с явным названием игры — по свежему
 * scripts/.cache/ocr.json (сначала python scripts/ocr-icons.py). Удаляет запись
 * из icons.json и файл с диска. Игра остаётся в режиме скриншотов.
 *
 * В отличие от stage-replacements.mjs, замену НЕ ищет — просто чистит. Нужен
 * после добавления новых игр (add-games.mjs), когда общее число иконок и так
 * растёт.
 */
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { CACHE, DATA, IMG, readJSON, writeJSON } from './lib.mjs';

const ICONS_DIR = join(IMG, 'icons');

async function main() {
  const iconsDoc = await readJSON(join(DATA, 'icons.json'));
  const ocr = await readJSON(join(CACHE, 'ocr.json'));
  if (!iconsDoc || !ocr) {
    console.error('нужны icons.json и scripts/.cache/ocr.json (сначала ocr-icons.py)');
    process.exit(1);
  }

  const drop = new Set(ocr.filter((x) => x.name_shown).map((x) => x.file));
  const kept = [];
  let removed = 0;
  for (const it of iconsDoc.icons) {
    if (drop.has(it.file)) {
      await rm(join(ICONS_DIR, it.file)).catch(() => {});
      removed++;
    } else {
      kept.push(it);
    }
  }
  iconsDoc.icons = kept;
  iconsDoc.count = kept.length;
  await writeJSON(join(DATA, 'icons.json'), iconsDoc);
  console.log(`[drop] убрано иконок с названием: ${removed}, осталось ${kept.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
