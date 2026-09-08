/**
 * Ищет на картинках название игры и записывает области блюра в данные.
 *
 * Зачем: викторина спрашивает «что за игра», и если название напечатано прямо
 * на кадре, вопрос решается чтением, а не знанием. Прошлый проход по иконкам
 * такие картинки просто удалял (215 штук), но кадров это лишает зря — достаточно
 * замылить надпись, движок это умеет (`render.js`, поле `blur`).
 *
 * Отличие от прежнего `ocr-shots-names.py`: тот же алгоритм, но на
 * tesseract.js — он уже в зависимостях проекта, а словарь `eng.traineddata`
 * лежит в репозитории. Питоновский вариант требовал rapidocr, которого на
 * машине может не быть, и проход было не повторить.
 *
 * Блюрится только текст, совпавший с названием игры. Прочий интерфейс на кадре
 * не трогаем: он игрока не выдаёт, а лишнее мыло портит картинку.
 *
 * Запуск:
 *   node scripts/ocr-blur.mjs shots          — по скриншотам
 *   node scripts/ocr-blur.mjs icons          — по иконкам
 *   node scripts/ocr-blur.mjs shots --dry    — только отчёт, данные не трогать
 *   node scripts/ocr-blur.mjs shots --limit 50
 *   node scripts/ocr-blur.mjs shots --files a.jpg,b.jpg
 */
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { ROOT, DATA, IMG, CACHE, readJSON, writeJSON } from './lib.mjs';
import { MANUAL_SHOTS, MANUAL_ICONS } from './blur-list.mjs';
import { STOP, nameTokens, isName, collectLines, mergeBoxes, readLines } from './ocr-lib.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

const KIND = process.argv[2] === 'icons' ? 'icons' : 'shots';
const DRY = has('dry');
const LIMIT = Number(arg('limit', 0));
/** Сколько картинок распознаём одновременно. */
const WORKERS = Number(arg('workers', 4));

/** Запас вокруг найденного текста, в долях кадра. */
const MARGIN = 0.015;
/** Если замылить пришлось бы больше — что-то не так, кадр в отчёт руками. */
const MAX_AREA = 0.45;
/** Ниже этой уверенности распознанное слово не считаем. */
const MIN_CONF = Number(arg('conf', 35));
/**
 * Во сколько раз увеличиваем картинку перед распознаванием. Кадры лежат в
 * ширине 512 — на них tesseract видит от силы каждую десятую надпись. Он
 * рассчитан на скан страницы, а не на мелкий кадр: увеличенная вдвое картинка
 * даёт на порядок больше находок.
 */
const SCALE = Number(arg('scale', 2));
/** Режимы сегментации страницы, по которым идём. */
const PSM_MODES = arg('psm', '11,6').split(',');

const round = (v) => Math.round(v * 1000) / 1000;

async function main() {
  const data = await readJSON(join(DATA, `${KIND}.json`));
  const games = (await readJSON(join(DATA, 'games.json')))?.games ?? [];
  const gameById = new Map(games.map((g) => [g.id, g]));
  let list = data?.[KIND] ?? [];
  const only = arg('files');
  if (only) {
    const want = new Set(only.split(',').map((x) => x.trim()));
    list = list.filter((it) => want.has(it.file));
  }
  if (LIMIT) list = list.slice(0, LIMIT);

  const dir = join(IMG, KIND);
  const manual = KIND === 'icons' ? MANUAL_ICONS : MANUAL_SHOTS;

  // Сбрасываем всё, что проставил прошлый прогон: иначе кадр, на котором OCR
  // сегодня ничего не нашёл, остался бы со вчерашней разметкой, и повторить
  // проход с нуля стало бы невозможно. Ручные области накладываются в конце.
  if (!DRY) {
    for (const it of list) {
      it.blur = [];
      it.clean = true;
    }
  }

  const found = [];
  const tooBig = [];
  let done = 0;

  const workers = await Promise.all(
    Array.from({ length: WORKERS }, () =>
      createWorker('eng', 1, { langPath: ROOT, gzip: false, cachePath: CACHE, logger: () => {} }),
    ),
  );

  const queue = [...list];
  const runOne = async (worker) => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      done++;
      if (done % 25 === 0) process.stdout.write(`\r[ocr] ${done}/${list.length}`);

      const game = gameById.get(item.gameId);
      const tokens = game ? nameTokens(game.name) : [];
      if (!tokens.length) continue;

      const path = join(dir, item.file);
      let meta;
      try {
        meta = await sharp(path).metadata();
      } catch {
        continue;
      }

      let lines;
      try {
        lines = await readLines(worker, path, meta, { scale: SCALE, psmModes: PSM_MODES });
      } catch (e) {
        console.warn(`\n[ocr] ${item.file}: ${e.message}`);
        continue;
      }

      // Строка попадает под блюр, если хоть одно её слово — часть названия.
      const hits = lines.filter((line) =>
        line.words.some((w) => w.confidence >= MIN_CONF && isName(w.text, tokens)),
      );
      if (!hits.length) continue;

      const boxes = mergeBoxes(
        hits.map((line) => {
          const x = line.bbox.x0 / meta.width - MARGIN;
          const y = line.bbox.y0 / meta.height - MARGIN;
          const w2 = (line.bbox.x1 - line.bbox.x0) / meta.width + MARGIN * 2;
          const h2 = (line.bbox.y1 - line.bbox.y0) / meta.height + MARGIN * 2;
          return {
            x: Math.max(0, x),
            y: Math.max(0, y),
            w: Math.min(1, w2 + Math.min(0, x)),
            h: Math.min(1, h2 + Math.min(0, y)),
          };
        }),
      ).map((b) => ({
        x: round(b.x),
        y: round(b.y),
        w: round(Math.min(b.w, 1 - b.x)),
        h: round(Math.min(b.h, 1 - b.y)),
      }));

      const area = boxes.reduce((sum, b) => sum + b.w * b.h, 0);
      const entry = {
        file: item.file,
        name: game.name,
        words: hits.map((line) => line.words.map((w) => w.text).join(' ')).join(' | '),
        boxes,
        area: round(area),
      };
      if (area > MAX_AREA) {
        tooBig.push(entry);
        continue;
      }
      found.push(entry);
      if (!DRY) {
        item.blur = boxes;
        item.clean = false;
      }
    }
  };

  await Promise.all(workers.map(runOne));
  await Promise.all(workers.map((w) => w.terminate()));
  process.stdout.write(`\r[ocr] ${done}/${list.length}\n`);

  // Ручная разметка поверх найденного автоматом: у OCR и глаз бывают разные
  // куски одной надписи, объединение закрывает обе.
  let manualApplied = 0;
  if (!DRY) {
    const byFile = new Map(list.map((it) => [it.file, it]));
    for (const [file, boxes] of Object.entries(manual)) {
      const it = byFile.get(file);
      if (!it) {
        console.warn(`[ocr] ручная разметка для ${file}: такого файла в данных нет`);
        continue;
      }
      it.blur = mergeBoxes([...(it.blur ?? []), ...boxes]).map((b) => ({
        x: round(b.x),
        y: round(b.y),
        w: round(b.w),
        h: round(b.h),
      }));
      it.clean = false;
      manualApplied++;
    }
    data.count = data[KIND].length;
    await writeJSON(join(DATA, `${KIND}.json`), data);
  }

  const report = { kind: KIND, checked: list.length, count: found.length, tooBig, found };
  await writeFile(join(CACHE, `ocr-blur-${KIND}.json`), JSON.stringify(report, null, 2) + '\n');

  console.log(`[ocr] проверено ${list.length}, название найдено на ${found.length}`);
  if (!DRY) console.log(`[ocr] ручной разметки наложено: ${manualApplied}`);
  if (tooBig.length) {
    console.log(`[ocr] ${tooBig.length} кадров пропущено — блюр закрыл бы больше ${MAX_AREA * 100}%:`);
    tooBig.slice(0, 10).forEach((e) => console.log(`   ${e.file} (${e.area})`));
  }
  console.log(`[ocr] отчёт: scripts/.cache/ocr-blur-${KIND}.json${DRY ? ' (данные не трогали)' : ''}`);
}

main().catch((e) => {
  console.error('[ocr]', e);
  process.exit(1);
});
