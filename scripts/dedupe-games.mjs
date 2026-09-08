/**
 * Убирает игры-дубли: записи с одинаковым названием (баг сборки — id с
 * суффиксом `-x`) и разные издания одной игры (Complete / Definitive / GOTY /
 * Remastered). Из-за них в вопросе оказывались два неразличимых варианта
 * ответа — именно такой вопрос попал на скриншот модератора Яндекса
 * («Grand Theft Auto IV: Complete Edition» и «… The Complete Edition»).
 * Из группы оставляем самую популярную запись. Запуск: node scripts/dedupe-games.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA = 'public/data';
const IMG = 'public/img';
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const write = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 2) + '\n');

/** Название без «издательских» слов и пунктуации — ключ группировки. */
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9а-я ]/g, ' ')
    .replace(/\b(the|complete|edition|definitive|remastered|goty|game of the year|deluxe|ultimate|retired|hd|classic)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const games = read('games.json');
const icons = read('icons.json');
const shots = read('shots.json');

const groups = new Map();
for (const g of games.games) {
  const k = norm(g.name);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(g);
}

const drop = new Set();
for (const [, list] of groups) {
  if (list.length < 2) continue;
  // Оставляем самую популярную: у неё, как правило, и картинки лучше.
  const keep = list.reduce((a, b) => ((b.owners || 0) > (a.owners || 0) ? b : a));
  for (const g of list) if (g.id !== keep.id) drop.add(g.id);
  console.log(`оставляем «${keep.name}», убираем: ${list.filter((g) => g.id !== keep.id).map((g) => `«${g.name}»`).join(', ')}`);
}

const rm = (dir, file) => {
  const p = path.join(IMG, dir, file);
  if (fs.existsSync(p)) fs.unlinkSync(p);
};
for (const it of icons.icons) if (drop.has(it.gameId)) rm('icons', it.file);
for (const it of shots.shots) if (drop.has(it.gameId)) rm('shots', it.file);

const before = games.games.length;
games.games = games.games.filter((g) => !drop.has(g.id));
icons.icons = icons.icons.filter((i) => !drop.has(i.gameId));
shots.shots = shots.shots.filter((s) => !drop.has(s.gameId));
games.count = games.games.length;
icons.count = icons.icons.length;
shots.count = shots.shots.length;
write('games.json', games);
write('icons.json', icons);
write('shots.json', shots);
console.log(`\nигр: ${before} -> ${games.count} (убрано ${drop.size}), иконок: ${icons.count}, скринов: ${shots.count}`);
