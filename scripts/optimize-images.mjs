/**
 * Сжимает картинки перед публикацией, чтобы архив влезал в лимит Яндекс Игр
 * и быстрее грузился на мобильном.
 *
 *   - иконки (PNG) → палитровый PNG (≤256 цветов): логотипы жмутся в разы
 *     без заметной потери; размер кадра оставляем 256×256.
 *   - скриншоты (JPEG) → ширина 512, качество 72 (mozjpeg).
 *
 * Файл перезаписывается только если стал меньше. Повторный запуск безопасен.
 *
 * Флаги: --dry — только показать план, ничего не писать.
 */
import { join } from 'node:path';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { IMG } from './lib.mjs';

const DRY = process.argv.includes('--dry');
const ICONS = join(IMG, 'icons');
const SHOTS = join(IMG, 'shots');
const mb = (b) => (b / 1024 / 1024).toFixed(1);

async function processDir(dir, transform) {
  const files = await readdir(dir).catch(() => []);
  let before = 0;
  let after = 0;
  let shrunk = 0;
  for (const name of files) {
    const path = join(dir, name);
    const src = await readFile(path);
    before += src.length;
    let out;
    try {
      out = await transform(sharp(src));
    } catch {
      after += src.length;
      continue;
    }
    if (out.length < src.length) {
      if (!DRY) await writeFile(path, out);
      after += out.length;
      shrunk++;
    } else {
      after += src.length;
    }
  }
  return { count: files.length, before, after, shrunk };
}

async function main() {
  console.log(DRY ? '[optimize] СУХОЙ ПРОГОН (ничего не пишем)\n' : '[optimize] сжимаю…\n');

  const icons = await processDir(ICONS, (img) =>
    img
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .png({ palette: true, quality: 90, effort: 8 })
      .toBuffer(),
  );
  console.log(
    `иконки: ${icons.count} шт, ${mb(icons.before)} → ${mb(icons.after)} МБ (сжато ${icons.shrunk})`,
  );

  const shots = await processDir(SHOTS, (img) =>
    img
      .resize(512, null, { withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer(),
  );
  console.log(
    `скриншоты: ${shots.count} шт, ${mb(shots.before)} → ${mb(shots.after)} МБ (сжато ${shots.shrunk})`,
  );

  const before = icons.before + shots.before;
  const after = icons.after + shots.after;
  console.log(`\n[optimize] итого: ${mb(before)} → ${mb(after)} МБ (−${mb(before - after)} МБ)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
