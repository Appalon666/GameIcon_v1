/**
 * Контактные листы для просмотра контента глазами.
 *
 * Требования площадки про запрещённый контент (п. 8.2.5) и про отвращение и
 * страх в материалах (п. 8.3.6) автоматикой не проверяются: отличить эмблему на
 * рукаве от узора, а кровь на текстуре от заката может только человек. При этом
 * открывать 1837 файлов по одному невозможно, поэтому картинки клеятся в листы
 * с подписями — лист просматривается за секунды, подозрительное открывается
 * отдельно.
 *
 * Запуск:
 *   node scripts/contact-sheet.mjs shots                     — все скриншоты
 *   node scripts/contact-sheet.mjs icons                     — все иконки
 *   node scripts/contact-sheet.mjs shots --genre Хоррор      — только жанр
 *   node scripts/contact-sheet.mjs shots --files a.jpg,b.jpg — точечный список
 *   node scripts/contact-sheet.mjs shots --from 200 --count 60
 *   node scripts/contact-sheet.mjs shots --blur      — с наложенным блюром
 *
 * Листы кладутся в `review/` (в архив игры не входит, см. pack.mjs — он пакует
 * только public/).
 */
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ROOT, DATA, IMG, readJSON } from './lib.mjs';

const OUT = join(ROOT, 'review');

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/**
 * Размер миниатюры и сетка листа. Значения по умолчанию подобраны так, чтобы
 * лист читался целиком: у скриншотов важен сюжет кадра, у иконок — символ на
 * ней, поэтому иконки можно класть плотнее.
 */
const CELL = Number(arg('cell', 256));
const COLS = Number(arg('cols', 5));
const ROWS = Number(arg('rows', 4));
const CAPTION = 26;
const PER_SHEET = COLS * ROWS;
const PAD = 8;
const BG = { r: 12, g: 16, b: 24, alpha: 1 };
/** Показывать картинки так, как их увидит игрок, — с наложенным блюром. */
const BLUR = process.argv.includes('--blur');

/**
 * Применяет к картинке те же области блюра, что увидит игрок.
 *
 * Повторяет лесенку из `public/js/render.js`: ужать область до ~4 пикселей по
 * высоте и растянуть обратно. Нужно, чтобы на листе был виден результат, а не
 * исходник: проверять надо то, что попадёт на экран.
 */
async function applyBlur(path, regions) {
  const meta = await sharp(path).metadata();
  let base = await sharp(path).png().toBuffer();

  for (const r of regions) {
    const left = Math.max(0, Math.round(r.x * meta.width));
    const top = Math.max(0, Math.round(r.y * meta.height));
    const w = Math.min(meta.width - left, Math.round(r.w * meta.width));
    const h = Math.min(meta.height - top, Math.round(r.h * meta.height));
    if (w < 2 || h < 2) continue;

    const factor = Math.max(2, Math.round(h / 4));
    const small = await sharp(base)
      .extract({ left, top, width: w, height: h })
      .resize(Math.max(1, Math.round(w / factor)), Math.max(1, Math.round(h / factor)))
      .png()
      .toBuffer();
    const back = await sharp(small).resize(w, h, { kernel: 'cubic' }).png().toBuffer();
    base = await sharp(base).composite([{ input: back, left, top }]).png().toBuffer();
  }
  return base;
}

/** Экранирует текст для вставки в SVG. */
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Подпись под миниатюрой: имя файла и название игры. */
function captionSvg(text, width, height) {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="100%" height="100%" fill="#0b0d12"/>` +
      `<text x="6" y="${height - 8}" font-family="Segoe UI, sans-serif" font-size="14"` +
      ` fill="#c8d3e0">${esc(text)}</text></svg>`,
  );
}

async function main() {
  const kind = process.argv[2] === 'icons' ? 'icons' : 'shots';
  const dir = join(IMG, kind);
  const data = await readJSON(join(DATA, `${kind}.json`));
  const games = (await readJSON(join(DATA, 'games.json')))?.games ?? [];
  const gameById = new Map(games.map((g) => [g.id, g]));

  let list = data?.[kind] ?? [];

  const only = arg('files');
  if (only) {
    const want = new Set(only.split(',').map((s) => s.trim()));
    list = list.filter((it) => want.has(it.file));
  }
  const genre = arg('genre');
  if (genre) list = list.filter((it) => gameById.get(it.gameId)?.genre === genre);

  const from = Number(arg('from', 0));
  const count = Number(arg('count', 0));
  if (from || count) list = list.slice(from, count ? from + count : undefined);

  if (!list.length) {
    console.log('[sheet] по фильтрам ничего не нашлось');
    return;
  }

  await mkdir(OUT, { recursive: true });

  const sheetW = COLS * (CELL + PAD) + PAD;
  const sheetH = ROWS * (CELL + CAPTION + PAD) + PAD;
  const sheets = Math.ceil(list.length / PER_SHEET);

  for (let s = 0; s < sheets; s++) {
    const slice = list.slice(s * PER_SHEET, (s + 1) * PER_SHEET);
    const layers = [];

    for (let i = 0; i < slice.length; i++) {
      const it = slice[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const left = PAD + col * (CELL + PAD);
      const top = PAD + row * (CELL + CAPTION + PAD);

      try {
        const src = it.blur?.length && BLUR
          ? await applyBlur(join(dir, it.file), it.blur)
          : join(dir, it.file);
        const thumb = await sharp(src)
          .resize(CELL, CELL, { fit: 'contain', background: BG })
          .png()
          .toBuffer();
        layers.push({ input: thumb, left, top });
      } catch {
        // Файла нет — оставляем пустую клетку, подпись всё равно нужна.
      }

      const name = gameById.get(it.gameId)?.name ?? it.gameId;
      layers.push({
        input: captionSvg(`${s * PER_SHEET + i + 1}. ${name}`, CELL, CAPTION),
        left,
        top: top + CELL,
      });
    }

    const out = join(OUT, `${kind}-${String(s + 1).padStart(3, '0')}.png`);
    await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: BG } })
      .composite(layers)
      .png({ compressionLevel: 9 })
      .toFile(out);
    process.stdout.write(`\r[sheet] ${s + 1}/${sheets}`);
  }

  // Список к листам: по нему потом искать файл по номеру из подписи.
  const index = list
    .map((it, i) => `${i + 1}\t${it.file}\t${gameById.get(it.gameId)?.name ?? it.gameId}\t${gameById.get(it.gameId)?.genre ?? ''}`)
    .join('\n');
  await writeFile(join(OUT, `${kind}-index.tsv`), index + '\n');

  console.log(`\n[sheet] ${list.length} картинок → ${sheets} листов в review/`);
}

main().catch((e) => {
  console.error('[sheet]', e);
  process.exit(1);
});
