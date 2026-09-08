# Отказ модерации Яндекс Игр — разбор и что сделано (2026-08-21)

Архив, который смотрел модератор, совпадает байт-в-байт с `dist/game.zip` и с
`public/` (sha256 `f1443ab9…e93e3e89`). Правим прямо в `public/`.

## Замечания и причины

| Пункт | Причина в проекте | Файл |
|---|---|---|
| 5.1.3 название | в игре «Угадай игру», в карточке «Угадай игру по иконке и скриншоту» | `index.html:6,20`, `promo/*-1-menu.png`, `img/hero.jpg`, `LISTING.md` |
| 2.7 возраст → 16+ | скрин Hunt: Showdown (кровь) | принято, спорить не будем |
| 1.10.1 обрезка | у `.screen--game` нет ландшафт-раскладки: 4-й ответ уезжает за экран | `css/style.css` (нет медиазапроса для игры) |
| 1.6.1.8 выделение iOS | `user-select:none` без `-webkit-` префикса — Safari ≤16.3 игнорирует | `css/style.css:56` |
| 8.4.2 ссылки | домены `steamgriddb.com` / `store.steampowered.com` в модалке «Об игре» | `index.html`, блок credits |
| 8.2.5 запрещённый контент | скриншот Schedule I (гроубокс) + найдена свастика в Wolfenstein II | `data/shots.json`, `img/shots/` |
| 3.5 права | иконки/скрины Steam — позиция в ответе модератору | — |
| формат описания | буллеты «•» и список режимов в поле «Об игре» | `LISTING.md` |
| 5.1.1.2 промо | pc-1/mobile-1 — меню, геймплея <70%, половина кадра пустая | `promo/`, `scripts/promo-shots.mjs` |

## Полный просмотр контента (1053 скриншота + 850 иконок, глазами)

### Обязательно убрать — прямые запреты
| Файл | Что |
|---|---|
| `schedule-i-1.jpg` | плантация конопли под фитолампами — претензия модератора |
| `wolfenstein-ii-the-new-colossus-1.jpg` | **свастика на нарукавной повязке крупным планом** |
| `postal-2-1.jpg` | игра целиком запрещённого толка |
| `mirror-1.jpg` | эротическая игра |

### Ссылки, домены и логотипы сторов (8.4.2)
`final-fantasy-xv-windows-edition-1.jpg` (лого STEAM + «Purchase on Steam»),
`frostpunk-1.jpg` (`www.frostpunkgame.com` + цены),
`dirt-rally-20-1.jpg` (лого Xbox/PS4/Steam/Windows/Oculus),
`warhammer-40-000-space-marine-2-1.jpg` (AMD/FOCUS),
`microsoft-flight-simulator-2020-…-1.jpg`, `watch-dogs-1.jpg`,
`insurgency-sandstorm-1.jpg`, `mortal-kombat-x-1.jpg` (цены),
`bright-memory-1.jpg` (NVIDIA RTX), `doom-doom-ii-1.jpg`

### Пресс-баджи и награды (чужие бренды, не геймплей)
`a-plague-tale-innocence-1.jpg`, `alan-wake-1.jpg`,
`life-is-strange-episode-1-1.jpg`, `outriders-1.jpg`, `pillars-of-eternity-1.jpg`

### Азартные игры
`balatro-1.jpg`, `governor-of-poker-3-1.jpg`, `liars-bar-1.jpg`,
`tabletop-simulator-1.jpg`, `raft-1.jpg`

### Жёсткая кровь / расчленёнка (решение за автором)
`chivalry-medieval-warfare-1.jpg`, `cruelty-squad-1.jpg`,
`dead-island-definitive-edition-1.jpg`, `dead-space-2-1.jpg`,
`dead-space-2008-1.jpg`, `hitman-2-silent-assassin-1.jpg`,
`payday-the-heist-1.jpg`, `surgeon-simulator-1.jpg`, `ultrakill-1.jpg`,
`world-war-z-1.jpg`, `serious-sam-3-bfe-1.jpg`,
`serious-sam-hd-the-first-encounter-1.jpg`, `call-of-duty-wwii-1.jpg`,
`prototype-1.jpg`

### Откровенное
`cyberpunk-2077-1.jpg` (обнажённая), `tower-of-fantasy-1.jpg`,
`vrchat-1.jpg`, `crush-crush-1.jpg`, `love-is-all-around-1.jpg`

### Иконки под замену
`company-of-heroes-legacy-edition.png` (офицер вермахта, Железный крест),
`return-to-castle-wolfenstein.png` (эмблема-орёл)

## Баг данных: 21 группа дублей (22 лишние записи)

Викторина показывает два неразличимых варианта ответа. 10 пар — точные тёзки
с id-суффиксом `-x` (баг `add-games.mjs`): `fear`/`fear-x`/`fear-x-x`,
`call-of-duty-ghosts`+`-x`, `medal-of-honor`+`-x`, `total-war-shogun-2`+`-x`,
`counter-strike-condition-zero`+`-x`, `call-of-duty-black-ops`+`-x`,
`call-of-duty-black-ops-ii`+`-x`, `call-of-duty-modern-warfare-2-2009`+`-x`,
`call-of-duty-modern-warfare-3-2011`+`-x`, `dark-messiah…`+`-x`,
`sid-meiers-civilization-iv`+`-x`.
Остальные — издания одной игры: GTA IV Complete / The Complete (это модератор
и заснял), BioShock / Remastered, BioShock 2 / Remastered, Fallout 3 / GOTY,
Mafia / Definitive, Mafia II Classic / Definitive, Sleeping Dogs / Definitive,
Ori / Definitive, Oblivion GOTY / GOTY Deluxe, AoE II Retired / Definitive.

## Что исправлено (21.08.2026)

Все правки — в `PATCH.md`, датасет чистится воспроизводимо скриптами
`scripts/moderation-clean.mjs` и `scripts/dedupe-games.mjs`.

| Пункт | Статус |
|---|---|
| 5.1.3 название | ✅ везде «Угадай игру по иконке и скриншоту»: `<title>`, `<h1>`, текст «Об игре», промо. Обложка и заставка уже были с полным названием |
| 2.7 возраст 16+ | ✅ принят, зафиксирован в `LISTING.md` |
| 1.10.1 обрезка | ✅ ландшафт-раскладка игрового экрана + компактный старт на низких окнах. Автотест: 0 проблем на 1280×800, 1000×630, 390×844, 844×390, 915×412 |
| 1.6.1.8 выделение iOS | ✅ `-webkit-user-select` + `-webkit-touch-callout` на body и всех кликабельных элементах |
| 8.4.2 ссылки | ✅ домены вырезаны из «Об игре»; в архиве не осталось ни одного URL, кроме SDK Яндекса. Кадры с логотипами сторов удалены |
| 8.2.5 контент | ✅ 5 игр и 22 кадра удалены; свастика в Wolfenstein II найдена и убрана |
| 3.5 права | ⚠️ позиция изложена в комментарии модератору — риск остаётся |
| формат описания | ✅ «Об игре» переписано сплошным текстом без маркеров |
| 5.1.1.2 промо | ✅ 8 кадров пересняты, все — геймплей |
| дубли ответов | ✅ 22 записи убраны, 1063 → 1036 игр |

Итог по датасету: **1036 игр, 827 иконок, 1010 скриншотов**, сирот и битых
ссылок нет. Архив — `dist/game.zip`, 33.0 МБ.

## Сторонний чекер (22.08.2026)

Прогнали Yandex Games Debug Checker v1.1.0
(github.com/Nioris/yandex-games-debug-checker) — `node scripts/run-debugchecker.mjs`.

**0 FAIL, 63–73 PASS, 11 WARN.** Первый прогон дал 3 FAIL:

- `SDK script tag` — настоящий: подключали абсолютный `https://yandex.ru/games/sdk/v2`
  вместо документированного `/sdk.js` (п. 1.1). Исправлено.
- `YaGames.init()` и `LoadingAPI.ready()` — ложные: чекер читает только файлы из
  тегов `<script src>` и не идёт по ES-импортам, а у нас четыре файла из пяти
  подключены импортами. В прогоне через прокси модули перечисляются тегами явно.

Из предупреждений по делу оказались три и все исправлены: перерисовка канваса по
`ResizeObserver` вместо одного `window.resize`, `overflow: hidden` на `html`,
зоны нажатия 44x44 (п. 1.8). Остальные 11 — неприменимы: заглушение звука на
рекламе (звука в игре нет), «мат» (стем внутри слова «тр*ебу*ет» в комментарии),
устаревшие методы лидербордов (наш helper зовёт современные первыми), имя
лидерборда передаётся переменной, «канвас не во весь экран» (у нас DOM-игра),
`touch-action: none` (сломал бы прокрутку модалок).
