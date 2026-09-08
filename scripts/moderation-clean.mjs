/**
 * Чистка датасета по замечаниям модерации Яндекс Игр (см. MODERATION.md).
 * Убирает игры и кадры с запрещённым контентом (нацистская символика,
 * наркотики, эротика) и маркетинговые коллажи с логотипами сторов и ссылками.
 * Запуск: node scripts/moderation-clean.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { DROP_GAMES, DROP_SHOTS, DROP_ICONS } from './moderation-list.mjs';

const DATA = 'public/data';
const IMG = 'public/img';

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const write = (f, o) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(o, null, 2) + '\n');

const games = read('games.json');
const icons = read('icons.json');
const shots = read('shots.json');

const dropped = new Set(DROP_GAMES);
const rmFile = (dir, file) => {
  const p = path.join(IMG, dir, file);
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
  return false;
};

// 1. Игры целиком: запись + все её иконки и скриншоты.
for (const g of DROP_GAMES) {
  for (const it of icons.icons.filter((i) => i.gameId === g)) rmFile('icons', it.file);
  for (const it of shots.shots.filter((s) => s.gameId === g)) rmFile('shots', it.file);
}
const gamesBefore = games.games.length;
games.games = games.games.filter((g) => !dropped.has(g.id));
icons.icons = icons.icons.filter((i) => !dropped.has(i.gameId));
shots.shots = shots.shots.filter((s) => !dropped.has(s.gameId));

// 2. Отдельные кадры и иконки.
for (const f of Object.keys(DROP_SHOTS)) rmFile('shots', f);
for (const f of Object.keys(DROP_ICONS)) rmFile('icons', f);
shots.shots = shots.shots.filter((s) => !DROP_SHOTS[s.file]);
icons.icons = icons.icons.filter((i) => !DROP_ICONS[i.file]);

games.count = games.games.length;
icons.count = icons.icons.length;
shots.count = shots.shots.length;
write('games.json', games);
write('icons.json', icons);
write('shots.json', shots);

// 3. Отчёт: игры, оставшиеся без единой картинки.
const withImg = new Set([...icons.icons, ...shots.shots].map((x) => x.gameId));
const noImg = games.games.filter((g) => !withImg.has(g.id));
console.log(`игр:   ${gamesBefore} -> ${games.count}`);
console.log(`иконок: ${icons.count}`);
console.log(`скринов: ${shots.count}`);
console.log(`без картинок (только как неверный вариант): ${noImg.length}`);
noImg.forEach((g) => console.log('   -', g.id));
