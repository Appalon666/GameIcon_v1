/**
 * Чистка датасета по замечаниям модерации Яндекс Игр (см. MODERATION.md).
 * Убирает игры и кадры с запрещённым контентом (нацистская символика,
 * наркотики, эротика) и маркетинговые коллажи с логотипами сторов и ссылками.
 * Запуск: node scripts/moderation-clean.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA = 'public/data';
const IMG = 'public/img';

/** Игры, которые убираем целиком — тема или контент под прямым запретом. */
const DROP_GAMES = [
  'schedule-i',          // наркоторговля, гроубокс — претензия модератора
  'postal-2',            // наркотики + крайнее насилие
  'mirror',              // эротическая игра
  'crush-crush',         // эротический дейт-сим
  'love-is-all-around',  // дейт-сим с реальными актрисами
];

/** Отдельные скриншоты под удаление: файл -> причина. */
const DROP_SHOTS = {
  'wolfenstein-ii-the-new-colossus-1.jpg': 'свастика на повязке',
  'cyberpunk-2077-1.jpg': 'обнажённая натура',
  'tower-of-fantasy-1.jpg': 'купальники, откровенные позы',
  'final-fantasy-xv-windows-edition-1.jpg': 'логотип Steam + «Purchase on Steam»',
  'frostpunk-1.jpg': 'www.frostpunkgame.com и ценники',
  'dirt-rally-20-1.jpg': 'логотипы Xbox/PS4/Steam/Windows/Oculus',
  'warhammer-40-000-space-marine-2-1.jpg': 'логотипы AMD/FOCUS, не геймплей',
  'watch-dogs-1.jpg': 'раскладка издания, не геймплей',
  'microsoft-flight-simulator-2020-40th-anniversary-edition-1.jpg': 'таблица изданий',
  'insurgency-sandstorm-1.jpg': 'таблица изданий + логотип FOCUS',
  'mortal-kombat-x-1.jpg': 'страница стора с ценами',
  'doom-doom-ii-1.jpg': 'маркетинговый коллаж',
  'a-plague-tale-innocence-1.jpg': 'пресс-оценки GameSpot/Screenrant',
  'alan-wake-1.jpg': 'пресс-оценки IGN/Eurogamer/PC Gamer',
  'life-is-strange-episode-1-1.jpg': 'награды BAFTA/Golden Joystick',
  'outriders-1.jpg': 'пресс-оценки Forbes/GameSpot',
  'pillars-of-eternity-1.jpg': 'пресс-цитаты Game Informer/IGN',
};

/** Отдельные иконки под удаление. */
const DROP_ICONS = {
  'company-of-heroes-legacy-edition.png': 'офицер вермахта, Железный крест',
  'return-to-castle-wolfenstein.png': 'эмблема-орёл в нацистской стилистике',
};

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
