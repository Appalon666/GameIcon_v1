/**
 * Приведение сырых жанров/тегов Steam к фиксированному набору жанров викторины
 * и расчёт тира узнаваемости по числу владельцев.
 *
 * Набор жанров держим небольшим и понятным русскоязычному игроку: он влияет и на
 * режим «играть по жанру», и на подбор неверных вариантов (из того же жанра).
 */

/** Жанры викторины (значения — то, что видит игрок). */
export const GENRES = [
  'Шутер',
  'Экшен',
  'RPG',
  'Стратегия',
  'MOBA',
  'Гонки',
  'Спорт',
  'Файтинг',
  'Хоррор',
  'Выживание',
  'Симулятор',
  'Песочница',
  'Приключения',
  'Платформер',
  'Головоломка',
];

/**
 * Теги Steam (по убыванию точности) → жанр викторины. Порядок важен: первый
 * совпавший тег и решает. Шутер и хоррор ставим раньше экшена, иначе почти всё
 * утекло бы в «Экшен».
 */
const TAG_RULES = [
  [/\bMOBA\b/i, 'MOBA'],
  [/battle\s*royale/i, 'Шутер'],
  [/hero shooter|\bFPS\b|shooter|\bTPS\b/i, 'Шутер'],
  [/survival horror|\bhorror\b/i, 'Хоррор'],
  [/souls-?like|\bJRPG\b|\bCRPG\b|action rpg|\bRPG\b|role-?playing/i, 'RPG'],
  [/\bRTS\b|real-?time strategy|turn-?based strategy|grand strategy|\b4X\b|tower defense|city builder|\bstrategy\b/i, 'Стратегия'],
  [/racing|driving|\bkart\b/i, 'Гонки'],
  [/\bsports?\b|football|soccer|basketball|hockey|baseball/i, 'Спорт'],
  [/fighting|beat\s?['’]?em up|\bbrawler\b/i, 'Файтинг'],
  [/battle royale|survival\b/i, 'Выживание'],
  [/farming sim|life sim|flight sim|automobile sim|\bsimulation\b|simulator/i, 'Симулятор'],
  [/sandbox|open world/i, 'Песочница'],
  [/platformer|precision platformer/i, 'Платформер'],
  [/puzzle|match\s?3|hidden object/i, 'Головоломка'],
  [/point\s?&\s?click|visual novel|\badventure\b|story rich/i, 'Приключения'],
  [/hack and slash|action\b|\barpg\b/i, 'Экшен'],
];

/** Запасной маппинг по крупному жанру Steam (поле genre в SteamSpy/Store). */
const GENRE_FALLBACK = {
  action: 'Экшен',
  adventure: 'Приключения',
  rpg: 'RPG',
  'role-playing': 'RPG',
  strategy: 'Стратегия',
  simulation: 'Симулятор',
  sports: 'Спорт',
  racing: 'Гонки',
  indie: 'Экшен',
  casual: 'Головоломка',
};

/**
 * Определяет жанр викторины.
 * @param {string} genreField сырой genre из данных Steam ("Action, Free To Play")
 * @param {string[]} tags список тегов по убыванию популярности
 * @returns {string|null} жанр викторины или null, если не удалось отнести
 */
export function classifyGenre(genreField = '', tags = []) {
  for (const tag of tags) {
    for (const [re, genre] of TAG_RULES) if (re.test(tag)) return genre;
  }
  // По крупному жанру — сначала тоже прогоняем через теговые правила (там богаче),
  // потом по прямому соответствию.
  const parts = String(genreField).split(/[,/]/).map((s) => s.trim());
  for (const part of parts) {
    for (const [re, genre] of TAG_RULES) if (re.test(part)) return genre;
  }
  for (const part of parts) {
    const hit = GENRE_FALLBACK[part.toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

/** Середина диапазона владельцев SteamSpy ("10,000,000 .. 20,000,000"). */
export function ownersMid(owners = '') {
  const nums = String(owners).match(/[\d,]+/g);
  if (!nums?.length) return 0;
  const vals = nums.map((n) => Number(n.replace(/,/g, '')));
  if (vals.length === 1) return vals[0];
  return (vals[0] + vals[1]) / 2;
}

/**
 * Тир узнаваемости по числу владельцев: 1 — знают почти все, 4 — нишевое.
 * Пороги подобраны грубо, потом подстроим по реальному распределению.
 */
export function tierFor(ownersMidValue) {
  if (ownersMidValue >= 20_000_000) return 1;
  if (ownersMidValue >= 5_000_000) return 2;
  if (ownersMidValue >= 1_500_000) return 3;
  return 4;
}
