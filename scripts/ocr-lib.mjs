/**
 * Общая часть распознавания текста на картинках.
 *
 * Отдельным модулем, потому что этим пользуются двое: `ocr-blur.mjs` (ставит
 * блюр на найденное название) и `blur-pick.mjs` (показывает все найденные
 * строки, чтобы выбрать нужную руками). Второй копии этой логики быть не
 * должно — разошлись бы координаты, и разметка перестала бы совпадать.
 */
import sharp from 'sharp';

/**
 * Слова, которые в названии ничего не значат: по ним совпало бы пол-интерфейса
 * («the» есть в любой надписи). Список — из прежнего питоновского прохода.
 */
export const STOP = new Set(['the', 'of', 'and', 'for', 'to', 'in', 'on', 'vr', 'hd', 'go', 'ii', 'iii', 'iv', 'edition', 'game']);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Значимые куски названия: короткие и служебные слова отбрасываем. */
export function nameTokens(name) {
  return (name.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

/** Похожесть строк 0..1 — грубая, но для «это то же слово?» достаточно. */
export function similar(a, b) {
  if (a === b) return 1;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (!long.length) return 1;
  // Расстояние Левенштейна на двух строках; строки короткие, память не жаль.
  let prev = Array.from({ length: short.length + 1 }, (_, i) => i);
  for (let i = 1; i <= long.length; i++) {
    const cur = [i];
    for (let j = 1; j <= short.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (long[i - 1] === short[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return 1 - prev[short.length] / long.length;
}

/** Это слово — часть названия игры? */
export function isName(text, tokens) {
  const t = norm(text);
  if (t.length < 4) return false;
  for (const tok of tokens) {
    if (t.includes(tok) || tok.includes(t)) return true;
    if (similar(tok, t) >= 0.8) return true;
  }
  return false;
}

/**
 * Собирает СТРОКИ из иерархии блоков, которую отдаёт tesseract.js.
 *
 * Именно строки, а не отдельные слова: у «Plants vs. Zombies» распознаётся одно
 * слово из трёх, и блюр по слову оставлял на кадре «PLANTS vs …ES» — ответ
 * по-прежнему читается, то есть работа сделана зря. Замыливаем строку целиком.
 */
export function collectLines(data) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node.lines)) {
      for (const line of node.lines) {
        if (Array.isArray(line.words) && line.words.length) {
          out.push({ bbox: line.bbox, words: line.words });
        }
      }
    }
    for (const key of ['blocks', 'paragraphs']) {
      if (Array.isArray(node[key])) node[key].forEach(walk);
    }
  };
  (data.blocks ?? []).forEach(walk);
  return out;
}

/** Объединяет пересекающиеся прямоугольники, пока есть что объединять. */
export function mergeBoxes(boxes) {
  const out = [...boxes];
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i];
        const b = out[j];
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        if (!overlap) continue;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.max(a.x + a.w, b.x + b.w) - x;
        const h = Math.max(a.y + a.h, b.y + b.h) - y;
        out.splice(j, 1);
        out[i] = { x, y, w, h };
        merged = true;
      }
    }
  }
  return out;
}

/**
 * Распознаёт картинку и возвращает слова в координатах ОРИГИНАЛА.
 *
 * Два прохода — по обычному изображению и по инвертированному. В играх надписи
 * чаще светлые на тёмном, а tesseract обучен на чёрном по белому: на негативе
 * он находит то, чего на оригинале не видит вовсе. Дубли потом схлопнет
 * mergeBoxes.
 */
export async function readLines(worker, path, meta, { scale = 2, psmModes = ['11', '6'] } = {}) {
  const base = sharp(path).resize({ width: Math.round(meta.width * scale) }).grayscale().normalise();
  const variants = [
    await base.clone().png().toBuffer(),
    await base.clone().negate().png().toBuffer(),
  ];

  const out = [];
  for (const buf of variants) {
    // Два режима сегментации: 11 «разрозненный текст» и 6 «единый блок». На
    // одном и том же логотипе они находят разные куски надписи — по
    // отдельности каждый режим оставлял половину названия на виду.
    for (const psm of psmModes) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const res = await worker.recognize(buf, {}, { blocks: true });
      for (const line of collectLines(res.data)) {
        out.push({
          words: line.words.map((w) => ({ text: w.text ?? '', confidence: w.confidence })),
          bbox: {
            x0: line.bbox.x0 / scale,
            y0: line.bbox.y0 / scale,
            x1: line.bbox.x1 / scale,
            y1: line.bbox.y1 / scale,
          },
        });
      }
    }
  }
  return out;
}

