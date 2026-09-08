/**
 * Помощник для ручной разметки блюра: кадр с координатной сеткой.
 *
 * Tesseract не читает стилизованные логотипы («OMORI», «Psychonauts», «UNO»
 * нарисованы своими шрифтами), поэтому `ocr-blur.mjs` их пропускает, а
 * викторина показывает кадр с готовым ответом. Такие надписи размечаются
 * глазами, и чтобы не гадать координаты, поверх кадра рисуется сетка в долях
 * от 0 до 1 — той же системе, в которой хранится разметка.
 *
 * Пробовал показывать вместо сетки рамки, которые нашёл сам tesseract: на
 * игровом кадре он находит «текст» в каждом кусте, тридцать рамок на картинку,
 * выбирать не из чего. Сетка честнее.
 *
 * Прочитанные по сетке области переносятся в `blur-list.mjs`. Для мышиной
 * разметки в проекте есть `tools/blur-editor.html` — он пишет прямо в данные.
 *
 * Запуск:
 *   node scripts/blur-pick.mjs --files omori-1.jpg,uno-1.jpg
 *   node scripts/blur-pick.mjs icons --files manor-lords.png
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { ROOT, IMG, DATA, readJSON } from './lib.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const KIND = process.argv[2] === 'icons' ? 'icons' : 'shots';
const OUT = join(ROOT, 'review');
/** Ширина кадра на листе: подписи сетки должны читаться. */
const VIEW_W = Number(arg('width', 620));
/** Сколько кадров на листе. */
const PER_SHEET = Number(arg('per', 4));

/** Сетка в долях кадра: крупные линии через 0.1, мелкие через 0.05. */
function gridSvg(w, h) {
  const parts = [];
  for (let i = 1; i < 20; i++) {
    const f = i / 20;
    const major = i % 2 === 0;
    const stroke = major ? 'rgba(255,60,110,0.55)' : 'rgba(255,255,255,0.18)';
    const width = major ? 1 : 0.5;
    parts.push(`<line x1="${f * w}" y1="0" x2="${f * w}" y2="${h}" stroke="${stroke}" stroke-width="${width}"/>`);
    parts.push(`<line x1="0" y1="${f * h}" x2="${w}" y2="${f * h}" stroke="${stroke}" stroke-width="${width}"/>`);
  }
  // Подписи по краям — только по крупным линиям, иначе каша.
  for (let i = 1; i < 10; i++) {
    const f = i / 10;
    parts.push(
      `<text x="${f * w + 2}" y="12" font-family="Segoe UI, sans-serif" font-size="11"` +
        ` fill="#ff3b6b" stroke="#000" stroke-width="0.4">${f.toFixed(1)}</text>`,
    );
    parts.push(
      `<text x="2" y="${f * h - 2}" font-family="Segoe UI, sans-serif" font-size="11"` +
        ` fill="#ff3b6b" stroke="#000" stroke-width="0.4">${f.toFixed(1)}</text>`,
    );
  }
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`);
}

function captionSvg(text, w, h) {
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="100%" height="100%" fill="#0b0d12"/>` +
      `<text x="4" y="17" font-family="Segoe UI, sans-serif" font-size="14" fill="#c8d3e0">` +
      `${text.replace(/[&<>]/g, '')}</text></svg>`,
  );
}

async function main() {
  const only = arg('files');
  if (!only) {
    console.error('нужен --files a.jpg,b.jpg');
    process.exit(1);
  }
  const files = only.split(',').map((x) => x.trim()).filter(Boolean);

  const data = await readJSON(join(DATA, `${KIND}.json`));
  const games = (await readJSON(join(DATA, 'games.json')))?.games ?? [];
  const gameById = new Map(games.map((g) => [g.id, g]));
  const byFile = new Map((data?.[KIND] ?? []).map((it) => [it.file, it]));

  await mkdir(OUT, { recursive: true });
  const dir = join(IMG, KIND);

  const cells = [];
  for (const file of files) {
    const path = join(dir, file);
    const meta = await sharp(path).metadata();
    const viewH = Math.round((VIEW_W * meta.height) / meta.width);
    const img = await sharp(path).resize(VIEW_W, viewH).png().toBuffer();
    const withGrid = await sharp(img)
      .composite([{ input: gridSvg(VIEW_W, viewH), top: 0, left: 0 }])
      .png()
      .toBuffer();
    const name = gameById.get(byFile.get(file)?.gameId)?.name ?? file;
    cells.push({ buf: withGrid, h: viewH, label: `${file} — ${name}` });
  }

  const PAD = 10;
  const CAP = 24;
  const cols = 2;
  for (let s = 0; s * PER_SHEET < cells.length; s++) {
    const slice = cells.slice(s * PER_SHEET, (s + 1) * PER_SHEET);
    const rowH = Math.max(...slice.map((c) => c.h)) + CAP + PAD;
    const sheetW = cols * (VIEW_W + PAD) + PAD;
    const sheetH = Math.ceil(slice.length / cols) * rowH + PAD;
    const layers = [];
    slice.forEach((c, i) => {
      const left = PAD + (i % cols) * (VIEW_W + PAD);
      const top = PAD + Math.floor(i / cols) * rowH;
      layers.push({ input: c.buf, left, top });
      layers.push({ input: captionSvg(c.label, VIEW_W, CAP), left, top: top + c.h });
    });
    const out = join(OUT, `pick-${String(s + 1).padStart(2, '0')}.png`);
    await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: { r: 12, g: 16, b: 24 } } })
      .composite(layers)
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log(`[pick] ${out}: ${slice.map((c) => c.label.split(' — ')[0]).join(', ')}`);
  }
}

main().catch((e) => {
  console.error('[pick]', e);
  process.exit(1);
});
