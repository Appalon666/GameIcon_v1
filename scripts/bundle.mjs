/**
 * Собирает data/bundle.json — единственный файл данных, который читает игра.
 *
 * Сырые games.json / icons.json / shots.json — рабочие файлы пайплайна: в них
 * адреса источников, авторы, флаги ручной проверки, сведения для подбора
 * тиров. Игре из этого нужно немного, а весили они 765 КБ и качались ДО
 * LoadingAPI.ready(): на Fast 3G это 6.7 с ожидания, на Slow 3G — 26 с. Сюда
 * попадает только то, что нужно в рантайме, и только играбельные медиа.
 *
 * Формат намеренно табличный: в JSON ключи повторяются на каждой записи, и на
 * тысяче игр «developer»/«gameId» весили больше самих значений. Обратно в
 * объекты строки разворачивает main.js (unpackBundle) — поля описаны там же и
 * здесь, версия формата в поле v: разъедутся — игра скажет об этом словами,
 * а не упадёт молча.
 *
 *   games: [id, name, genre, tier, developer, year]
 *   icons: [gameId, blur?]      файл — img/icons/<gameId>.png
 *   shots: [gameId, blur?]      файл — img/shots/<gameId>-1.jpg
 *
 * Имя файла не хранится: в наборе оно всегда по шаблону от id, и сборка это
 * проверяет — файл не по шаблону останавливает её с понятной ошибкой, а не
 * молча теряется в игре.
 *
 * Запуск: npm run bundle. Сам вызывается из build, pack и дев-сервера, так что
 * руками нужен редко — после правки данных в обход этих трёх.
 */
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { DATA, readJSON } from './lib.mjs';

/** Версия формата. Меняется вместе с unpackBundle в main.js. */
export const BUNDLE_VERSION = 1;
export const BUNDLE_FILE = join(DATA, 'bundle.json');

/** Тот же отбор, что делал Game: замазано рамками или помечено чистым, не брак. */
const playable = (it) => (it.blur?.length || it.clean) && !it.skip;

const FILE_OF = { icon: (id) => `${id}.png`, shot: (id) => `${id}-1.jpg` };

/**
 * Читает сырые данные, отбирает нужное игре и пишет data/bundle.json.
 * Бросает ошибку на сироте (медиа без игры) и на файле не по шаблону: такое
 * должно останавливать сборку, а не доезжать до игрока.
 * @returns {Promise<{path:string, bytes:number, games:number, icons:number, shots:number}>}
 */
export async function buildBundle() {
  const games = (await readJSON(join(DATA, 'games.json')))?.games ?? [];
  const icons = (await readJSON(join(DATA, 'icons.json')))?.icons ?? [];
  const shots = (await readJSON(join(DATA, 'shots.json')))?.shots ?? [];
  const gameById = new Map(games.map((g) => [g.id, g]));

  const rows = (list, kind) =>
    list.filter(playable).map((it) => {
      if (!gameById.has(it.gameId)) throw new Error(`bundle: ${kind} ${it.file} — нет игры ${it.gameId}`);
      const expected = FILE_OF[kind](it.gameId);
      if (it.file !== expected) throw new Error(`bundle: ${kind} ${it.file} — ожидалось имя ${expected}`);
      return it.blur?.length ? [it.gameId, it.blur] : [it.gameId];
    });
  const iconRows = rows(icons, 'icon');
  const shotRows = rows(shots, 'shot');

  // Игры без единого играбельного медиа в рантайме не нужны: ни вопросом, ни
  // вариантом ответа они не станут (варианты берутся только из играбельных).
  const used = new Set([...iconRows, ...shotRows].map(([id]) => id));
  const gameRows = games
    .filter((g) => used.has(g.id))
    .map((g) => [g.id, g.name, g.genre ?? '', g.tier ?? null, g.developer ?? '', g.year ?? null]);

  // По строке на запись: файл генерируемый, но лежит в git, и построчная
  // запись даёт читаемый diff вместо одной строки на 150 КБ.
  const table = (list) => `[\n${list.map((r) => JSON.stringify(r)).join(',\n')}\n]`;
  const text =
    `{"v":${BUNDLE_VERSION},\n"games":${table(gameRows)},\n` +
    `"icons":${table(iconRows)},\n"shots":${table(shotRows)}}\n`;
  await writeFile(BUNDLE_FILE, text);

  return {
    path: BUNDLE_FILE,
    bytes: Buffer.byteLength(text),
    games: gameRows.length,
    icons: iconRows.length,
    shots: shotRows.length,
  };
}

/** Строка для консоли: что собрано и сколько весит. */
export const describeBundle = (b) =>
  `data/bundle.json: ${(b.bytes / 1024).toFixed(0)} КБ — игр ${b.games}, иконок ${b.icons}, скриншотов ${b.shots}`;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  buildBundle()
    .then((b) => console.log(`[bundle] ${describeBundle(b)}`))
    .catch((e) => {
      console.error('[bundle]', e.message);
      process.exit(1);
    });
}
