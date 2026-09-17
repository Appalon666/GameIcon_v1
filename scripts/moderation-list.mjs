/**
 * Что вычищено из датасета по требованиям площадки — один список на всех.
 *
 * Отдельным модулем, потому что список нужен двоим: `moderation-clean.mjs`
 * по нему чистит, `verify-moderation.mjs` по нему же проверяет, что вычищенное
 * не вернулось. Второй такой список рано или поздно разошёлся бы с первым, и
 * проверка перестала бы что-либо стеречь.
 */

/** Игры, которые убираем целиком — тема или контент под прямым запретом. */
export const DROP_GAMES = [
  'schedule-i',          // наркоторговля, гроубокс — претензия модератора
  'postal-2',            // наркотики + крайнее насилие
  'mirror',              // эротическая игра
  'crush-crush',         // эротический дейт-сим
  'love-is-all-around',  // дейт-сим с реальными актрисами
  'mirror-2-project-x',  // продолжение той же эротической головоломки, что и mirror

  // Разбор кадров с замазанными названиями 17.09.2026 (MODERATION.md): у этих
  // двух единственное медиа — титульный экран или меню сплошным текстом,
  // с заклеенным названием в центре. Такой кадр не вопрос, а пятно.
  'world-of-guns-gun-disassembly',  // единственный кадр — меню «Operate Mode features»
  'secret-in-story',                // единственный кадр — титульник: силуэт, название, кнопка Play
];
/** Отдельные скриншоты под удаление: файл -> причина. */
export const DROP_SHOTS = {
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

  // Сплошной просмотр 08.09.2026. Прошлый разбор эти кадры нашёл, но оставил
  // «на решение автора», и они уехали в игру. Требования запрещают в
  // материалах уродства и искажённые существа, вызывающие сильное отвращение
  // или страх, и отдельно — фокус на крови и тяжёлых травмах.
  'chivalry-medieval-warfare-1.jpg': 'отрубленная рука, фонтан крови',
  'ultrakill-1.jpg': 'экран залит кровью',
  'dead-space-2008-1.jpg': 'некроморф, кровь',
  'dead-space-2-1.jpg': 'некроморф рвёт человека',
  'serious-sam-3-bfe-1.jpg': 'освежёванные существа',
  'serious-sam-hd-the-first-encounter-1.jpg': 'обезглавленный камикадзе, кровь на земле',
  'call-of-duty-wwii-1.jpg': 'лицо зомби крупным планом',
  'hitman-2-silent-assassin-1.jpg': 'подвешенное тело, кровь',
  'surgeon-simulator-1.jpg': 'вскрытая грудная клетка, органы',
  'dead-island-definitive-edition-1.jpg': 'зомби над телом на пляже, кровь',
  'world-war-z-1.jpg': 'масса окровавленных зомби крупным планом',
  'the-first-berserker-khazan-1.jpg': 'освежёванное существо',

  // Азартные игры — отдельный запрет, к геймплею претензий нет.
  'balatro-1.jpg': 'покерные комбинации',
  'governor-of-poker-3-1.jpg': 'казино и обещание «дойти до Лас-Вегаса»',
  'liars-bar-1.jpg': 'карточная игра на ставки',
  'tabletop-simulator-1.jpg': 'покерный стол с фишками',
  'poker-night-at-the-inventory-1.jpg': 'покерный стол',
  'buckshot-roulette-1.jpg': 'русская рулетка с дробовиком',

  // Разбор кадров с замазанными названиями 17.09.2026: кадр целиком — заклеенное
  // название или меню с чужим текстом; у игр есть другое медиа.
  'castle-crashers-1.jpg': 'меню с надписью «Steam Edition» — упоминание магазина (п. 8.4.2)',
  'dota-underlords-1.jpg': 'экран «Welcome to White Spire» сплошным текстом, не геймплей',
  'papers-please-1.jpg': 'титульный экран: размытое пятно вместо логотипа в центре',
  'catan-universe-1.jpg': 'то же — большая клякса посреди кадра',
  'omori-1.jpg': 'титульный экран с меню New game / Continue',
};
/** Отдельные иконки под удаление: файл -> причина. */
export const DROP_ICONS = {
  'company-of-heroes-legacy-edition.png': 'офицер вермахта, Железный крест',
  'return-to-castle-wolfenstein.png': 'эмблема-орёл в нацистской стилистике',

  // Сплошной просмотр 08.09.2026.
  'day-of-defeat-source.png': 'Железный крест — то же, за что убрана иконка Company of Heroes',
  'tabletop-simulator.png': 'фишка казино, карты и кости',
  'balatro.png': 'игральные карты',
  'poker-night-at-the-inventory.png': 'рулетка казино',

  // Разбор 17.09.2026.
  'farthest-frontier.png': 'иконка — чистый логотип-надпись: полоса замазки название не прячет',
};