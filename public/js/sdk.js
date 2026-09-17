/**
 * Обёртка над SDK Яндекс Игр.
 * Вне площадки (локальная разработка) SDK нет — тогда все методы работают
 * как заглушки, чтобы игру можно было спокойно тестировать в браузере.
 */

import { MAX_POINTS_PER_QUESTION } from './game.js';

/**
 * Подпись партии в extraData лидерборда.
 *
 * Площадка принимает от клиента любое число: одна строчка в консоли браузера
 * ставит рекорд без единой партии, и проверить это негде — у Яндекса нет
 * серверной логики, только хранилище. Поэтому вместе с очками кладём сводку
 * партии и подпись от неё, а при показе таблицы верим только строкам, у
 * которых подпись сходится и цифры укладываются в правила. Соль лежит в
 * клиенте: кто разберёт код, подпись повторит, — это барьер против консоли и
 * готовых скриптов, не против разработчика.
 *
 * Формат extraData: `1|q|c|t|m|k|sig` — версия, вопросов, верных, секунд,
 * режим (первая буква), тип картинок (первая буква), подпись.
 */
const SIGN_VERSION = 1;
const SIGN_SALT = 'rename-the-shortcut-2026-09';
/** Быстрее этого человек не отвечает: картинке надо загрузиться и показаться. */
const MIN_SECONDS_PER_QUESTION = 1;

/** FNV-1a по байтам UTF-8, 32 бита в hex. Две прогонки с разными сидами дают 64. */
function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (const byte of new TextEncoder().encode(str)) {
    h ^= byte;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function signature(score, fields) {
  const base = [score, ...fields, SIGN_SALT].join('|');
  return fnv1a(base, 0x811c9dc5) + fnv1a(base, 0x9747b28c);
}

/** Сводка партии → поля extraData (без подписи). */
function summaryFields({ questions, correct, seconds, mode, kind }) {
  return [SIGN_VERSION, questions, correct, seconds, String(mode)[0], String(kind)[0]];
}

/**
 * Укладываются ли очки в правила: верных не больше вопросов, очков не больше
 * «верных × максимум за вопрос», времени не меньше секунды на вопрос.
 */
function plausible(score, { questions, correct, seconds }) {
  return (
    Number.isInteger(questions) && questions >= 1 &&
    Number.isInteger(correct) && correct >= 0 && correct <= questions &&
    Number.isFinite(seconds) && seconds >= questions * MIN_SECONDS_PER_QUESTION &&
    score >= 0 && score <= correct * MAX_POINTS_PER_QUESTION
  );
}

/**
 * extraData для отправки: сводка и подпись. Не экспортируется намеренно:
 * экспортированную функцию из консоли фрейма зовут одной строкой через
 * import('/js/sdk.js'), и соль знать не нужно. Проверки повторяют алгоритм
 * у себя (scripts/check-leaderboard.mjs).
 */
function signExtraData(score, stats) {
  const fields = summaryFields(stats);
  return [...fields, signature(score, fields)].join('|');
}

/**
 * Проверка строки таблицы. Без extraData — из консоли; подпись не сходится —
 * подделана; подпись сходится, а цифры невозможные — тоже подделана.
 * @returns {boolean}
 */
function verifyEntry(score, extraData) {
  if (typeof extraData !== 'string') return false;
  const parts = extraData.split('|');
  if (parts.length !== 7 || Number(parts[0]) !== SIGN_VERSION) return false;
  const fields = [SIGN_VERSION, Number(parts[1]), Number(parts[2]), Number(parts[3]), parts[4], parts[5]];
  if (signature(Number(score), fields) !== parts[6]) return false;
  return plausible(Number(score), { questions: fields[1], correct: fields[2], seconds: fields[3] });
}

/**
 * Технические имена лидербордов — их нужно создать в консоли разработчика
 * ровно с такими именами. Пять таблиц: обычный режим разбит по типу контента
 * (всё / только иконки / только скриншоты), плюс отдельные «на время» и «хардкор».
 * Ключи — это ключи таблиц (BOARD в game.js), а не режимов.
 */
export const LEADERBOARD = {
  total: 'leadtotal',
  icons: 'leadicons',
  shots: 'leadshots',
  timed: 'leadtimetotal',
  hardcore: 'leadhardcore',
};

/** Ключи всех таблиц — для обхода при чтении/записи рекордов. */
const BOARDS = Object.keys(LEADERBOARD);

/** Пустой набор рекордов: по нулю на каждую таблицу. */
function emptyBest() {
  return Object.fromEntries(BOARDS.map((b) => [b, 0]));
}

/** Приводит сырой объект рекордов к числам по всем таблицам. */
function coerceBest(raw) {
  const best = {};
  for (const b of BOARDS) best[b] = Number(raw?.[b]) || 0;
  return best;
}

/**
 * Подпись рекордов в сохранении. Облако площадки, как и таблица, пишет то, что
 * прислали: рекорд правится из консоли той же строкой. Чужим подделка не видна
 * (это меню самого читера и его порог отправки), но лазейку закрываем и здесь:
 * рекорды с неверной подписью считаем нулями. Сохранения до этой версии, без
 * подписи, принимаем — иначе при обновлении обнулились бы рекорды честных.
 */
function bestSignature(best) {
  return signature('best', BOARDS.map((b) => best[b] ?? 0));
}

function readSignedBest(raw) {
  const best = coerceBest(raw);
  if (raw && typeof raw === 'object' && 'sig' in raw && raw.sig !== bestSignature(best)) {
    console.warn('[sdk] рекорды в сохранении не сходятся с подписью — считаем нулями');
    return emptyBest();
  }
  return best;
}

/**
 * Яндекс требует не меньше 60 секунд между межстраничными показами: более
 * частые вызовы площадка просто игнорирует. Держим свой счётчик, чтобы не
 * дёргать SDK впустую и не сбивать ритм игры.
 */
const INTERSTITIAL_COOLDOWN_MS = 60_000;
let lastInterstitialAt = 0;

/**
 * Сторожа рекламы. Двухступенчатые, и это важно: один короткий таймаут на всё
 * означал бы, что игра оживает ПОД ещё идущим роликом — звук и геймплей во
 * время полноэкранной рекламы площадка запрещает (п. 4.7), а следующий вопрос
 * успевал бы прийти и уйти невидимым для игрока.
 *   - OPEN — реклама не открылась вовсе (SDK молчит): ждём немного;
 *   - CLOSE — открылась, но onClose/onError не пришли: ждём долго, дольше
 *     любого реального ролика, иначе вернётся «вечная пауза» (п. 1.14).
 */
const AD_OPEN_TIMEOUT_MS = 15_000;
const AD_CLOSE_TIMEOUT_MS = 180_000;

/**
 * Показ рекламы — критическая секция на одного. Сторожа и флаги показа общие,
 * и второй вызов затирал бы развязку первого: тот остался бы без onClose, то
 * есть без снятия паузы.
 */
let adBusy = false;

/** Таймаут на любой запрос к SDK: своих таймаутов у методов площадки нет. */
const SDK_TIMEOUT_MS = 8000;

/**
 * Игра внутри iframe площадки. Вне его (локальная разработка, прямое открытие
 * сборки) SDK может загрузиться и даже отдать объект, но `postMessage` слать
 * некому: колбэки рекламы не приходят вовсе, и игра стоит до сторожа.
 */
function embedded() {
  try {
    return window.self !== window.top;
  } catch {
    // Доступ к window.top запрещён политикой — значит, мы точно в чужом iframe.
    return true;
  }
}

/**
 * Обещание SDK с таймаутом. Без него подвисший запрос профиля останавливал
 * партию наглухо: экран итогов ждал его вечно.
 */
function withTimeout(promise, label, ms = SDK_TIMEOUT_MS) {
  // Отдельная ветка на случай, когда гонку выиграл таймаут: отказ исходного
  // промиса придёт позже и обрабатывать его будет уже некому — в консоли он
  // всплывёт как unhandled rejection (рек. 6.4, п. 1.14).
  Promise.resolve(promise).catch(() => {});
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: таймаут ${ms} мс`)), ms)),
  ]);
}

/**
 * Вызов площадки, ответа которого никто не ждёт: ready(), метки геймплея,
 * запуск ролика. Синхронный try ловит только брошенное исключение, а методы
 * SDK возвращают промис: вне iframe площадки он отклоняется («No parent to
 * post message»), и без своего catch отказ летит в консоль необработанным.
 *
 * @param {string} label что зовём — попадёт в предупреждение
 * @param {() => unknown} run сам вызов
 * @param {() => void} [onFail] что сделать при отказе, кроме записи в консоль
 */
function fireAndForget(label, run, onFail) {
  const fail = (e) => {
    console.warn(`[sdk] ${label}:`, e?.message ?? e);
    onFail?.();
  };
  try {
    const res = run();
    if (res && typeof res.then === 'function') res.then(undefined, fail);
  } catch (e) {
    fail(e);
  }
}

/**
 * Что площадка пропустила, пока SDK не поднялся. Если init доедет позже нашего
 * таймаута, эти вызовы надо повторить: иначе LoadingAPI.ready() не уйдёт
 * никогда и для площадки игра останется вечно загружающейся (п.1.19).
 */
const pending = { ready: false, gameplay: null, pause: null };

function flushPlatformState() {
  if (pending.pause) {
    const [onPauseFn, onResumeFn] = pending.pause;
    pending.pause = null;
    sdk.onPause(onPauseFn, onResumeFn);
  }
  if (pending.ready) {
    pending.ready = false;
    sdk.ready();
  }
  const g = pending.gameplay;
  pending.gameplay = null;
  if (g === 'start') sdk.gameplayStart();
  else if (g === 'stop') sdk.gameplayStop();
}

let ysdk = null;
let playerP = null;
let leaderboards = null;
/** @type {Record<string, number>|null} рекорд по таблицам, прочитанный один раз за сессию */
let bestCache = null;

/**
 * Игрок площадки. Промис, а не значение: иначе параллельные вызовы
 * (отправка результата и чтение рекорда) стартовали бы два запроса.
 */
function getPlayer() {
  // Неудачу не запоминаем: следующий вызов попробует ещё раз.
  playerP ??= withTimeout(ysdk.getPlayer({ scopes: false }), 'getPlayer').catch((e) => {
    playerP = null;
    throw e;
  });
  return playerP;
}

/** Ключ, под которым лежит рекорд по таблицам: { total, icons, shots, timed, hardcore }. */
const BEST_KEY = 'best';

/**
 * У лидербордов две версии API. Актуальная (`ysdk.leaderboards`) — это
 * `setScore` / `getEntries`, устаревшая (`ysdk.getLeaderboards()`) —
 * `setLeaderboardScore` / `getLeaderboardEntries`. Зовём то, что реально есть
 * у объекта: иначе вызов падает с TypeError и результат тихо не уходит.
 */
function callLeaderboard(newName, oldName, ...args) {
  const fn = leaderboards?.[newName] ?? leaderboards?.[oldName];
  if (typeof fn !== 'function') {
    throw new Error(`нет метода ${newName}/${oldName} у объекта лидербордов`);
  }
  return fn.call(leaderboards, ...args);
}

/**
 * Актуальный доступ — `ysdk.leaderboards`; `getLeaderboards()` объявлен
 * устаревшим и пишет ошибку в консоль. Старый вызов оставлен запасным для
 * клиентов, где новое свойство ещё не появилось.
 */
async function attachLeaderboards() {
  try {
    leaderboards = ysdk.leaderboards ?? (await withTimeout(ysdk.getLeaderboards(), 'getLeaderboards'));
    console.info(
      '[sdk] лидерборды:',
      leaderboards ? Object.keys(Object.getPrototypeOf(leaderboards) ?? {}) : 'нет объекта',
    );
  } catch (e) {
    console.warn('[sdk] лидерборды недоступны:', e?.message ?? e);
  }
}

/**
 * Строка игрока, уже лежащая в таблице. Нужна перед отправкой: сравнить новую
 * партию с тем, что записано, площадка сама не умеет.
 * @returns {Promise<{score:number, verified:boolean}|null>} score 0 — игрока в
 *   таблице ещё нет, это первый результат; verified — сходится ли подпись
 *   строки; null — строку прочитать не удалось, сравнивать не с чем.
 */
async function playerEntry(name) {
  try {
    const entry = await withTimeout(
      callLeaderboard('getPlayerEntry', 'getLeaderboardPlayerEntry', name),
      'getPlayerEntry',
    );
    const score = Number(entry?.score) || 0;
    return { score, verified: verifyEntry(score, entry?.extraData) };
  } catch (e) {
    // «Игрока нет в таблице» — не сбой, а обычный первый заход: пусть шлёт.
    const reason = e?.code ?? e?.message ?? String(e);
    if (/NOT_PRESENT/i.test(String(reason))) return { score: 0, verified: true };
    console.warn('[sdk] getPlayerEntry:', reason);
    return null;
  }
}

/**
 * Читает рекорды: из облака площадки, вне площадки — из localStorage.
 * Возвращает `null`, если прочитать **не удалось**, и это не то же самое, что
 * «рекордов нет»: нули в ответе на сбой дают право переписать ими облако.
 *
 * Успешное чтение держим в памяти — рекорд меняется только отсюда же, и иначе
 * каждая партия стоила бы лишних запросов. Неудачу не запоминаем: следующая
 * партия попробует ещё раз.
 */
async function readBest() {
  if (bestCache) return bestCache;
  try {
    if (!ysdk) return (bestCache = readLocalBest());
    const data = await withTimeout(getPlayer().then((p) => p.getData([BEST_KEY])), 'getData');
    return (bestCache = readSignedBest(data?.[BEST_KEY]));
  } catch (e) {
    console.warn('[sdk] loadBest:', e?.message ?? e);
    return null;
  }
}

/** Рекорд вне площадки: SDK нет, храним в браузере. */
function readLocalBest() {
  try {
    return readSignedBest(JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}'));
  } catch {
    return emptyBest();
  }
}

export const sdk = {
  get available() {
    return ysdk !== null;
  },

  /** Язык интерфейса площадки: 'ru' | 'en' | ... */
  lang: 'ru',

  async init() {
    if (typeof YaGames === 'undefined') {
      console.info('[sdk] YaGames недоступен — режим локальной разработки');
      return;
    }
    const initP = YaGames.init();
    // Если init доедет уже ПОСЛЕ нашего таймаута, подхватываем SDK и повторяем
    // то, что площадка успела пропустить. Иначе на медленной сети площадка
    // навсегда остаётся без LoadingAPI.ready() и считает игру загружающейся.
    initP
      .then(async (late) => {
        if (ysdk || !late) return;
        ysdk = late;
        sdk.lang = ysdk.environment?.i18n?.lang ?? 'ru';
        await attachLeaderboards();
        flushPlatformState();
        console.info('[sdk] SDK доехал после таймаута — состояние площадки повторено');
      })
      .catch(() => {});

    try {
      // Таймаут: если YaGames.init() зависнет (вне площадки, в превью модерации,
      // при блокировке SDK), игра не должна застрять на экране загрузки —
      // продолжаем как локально, а ветка выше подхватит SDK, если он всё же придёт.
      ysdk = await withTimeout(initP, 'init');
      sdk.lang = ysdk.environment?.i18n?.lang ?? 'ru';
      await attachLeaderboards();
    } catch (e) {
      console.warn('[sdk] init не удался:', e?.message ?? e);
      ysdk = null;
    }
  },

  /**
   * Подписка на события паузы/возобновления площадки (`game_api_pause` /
   * `game_api_resume`). Площадка шлёт их, когда сама приостанавливает игру
   * (системный оверлей, входящий звонок, переключение вкладки на её стороне).
   * Дополняет наши GameplayAPI и visibilitychange. Вне площадки — тихо ничего.
   */
  onPause(onPauseFn, onResumeFn) {
    if (!ysdk) {
      // SDK ещё не поднялся: подпишемся, когда доедет, иначе паузы площадки
      // не дойдут до игры вовсе.
      pending.pause = [onPauseFn, onResumeFn];
      return;
    }
    if (typeof ysdk.on !== 'function') return;
    try {
      ysdk.on('game_api_pause', onPauseFn);
      ysdk.on('game_api_resume', onResumeFn);
    } catch (e) {
      console.warn('[sdk] onPause:', e?.message ?? e);
    }
  },

  /** Сообщает площадке, что загрузка закончена и можно убирать прелоадер. */
  ready() {
    if (!ysdk) {
      pending.ready = true;
      return;
    }
    fireAndForget('LoadingAPI.ready', () => ysdk.features?.LoadingAPI?.ready());
  },

  /**
   * Отметки начала и паузы геймплея. Площадка использует их, чтобы не
   * показывать рекламу поверх активной игры и корректно считать вовлечённость.
   * Вызывать нужно парно: gameplayStart при входе в партию, gameplayStop —
   * перед рекламой, на экране итогов и когда вкладка уходит в фон.
   */
  gameplayStart() {
    if (!ysdk) {
      pending.gameplay = 'start';
      return;
    }
    fireAndForget('GameplayAPI.start', () => ysdk.features?.GameplayAPI?.start());
  },

  gameplayStop() {
    if (!ysdk) {
      pending.gameplay = 'stop';
      return;
    }
    fireAndForget('GameplayAPI.stop', () => ysdk.features?.GameplayAPI?.stop());
  },

  /** Гость ли игрок (без аккаунта Яндекса): площадка не принимает от него результаты. */
  async isGuest() {
    if (!ysdk) return false;
    try {
      return (await getPlayer()).getMode() === 'lite';
    } catch {
      return false;
    }
  },

  /** Прошло ли достаточно времени с прошлой межстраничной рекламы. */
  get interstitialReady() {
    return Date.now() - lastInterstitialAt >= INTERSTITIAL_COOLDOWN_MS;
  },

  /**
   * Межстраничная реклама. Резолвится всегда — игра не должна зависать,
   * если реклама не показалась или SDK ответил ошибкой.
   * @param {{respectCooldown?: boolean}} [opts] respectCooldown — не показывать
   *   чаще, чем раз в минуту (для рекламы по ходу партии).
   */
  showInterstitial(opts = {}) {
    // Вне iframe площадки колбэки не придут вовсе — SDK не зовём, иначе каждая
    // реклама вешала бы игру до срабатывания сторожа.
    if (!embedded()) return Promise.resolve();
    if (opts.respectCooldown && !sdk.interstitialReady) return Promise.resolve();
    if (!ysdk?.adv) return Promise.resolve();
    if (adBusy) {
      console.warn('[sdk] interstitial: показ уже идёт, второй не начинаем');
      return Promise.resolve();
    }
    // Отсчёт от попытки: даже если реклама не откроется, дёргать SDK чаще раза
    // в минуту незачем. Реальный показ переставит отсчёт в onOpen.
    lastInterstitialAt = Date.now();
    adBusy = true;
    return new Promise((resolve) => {
      let done = false;
      let guard;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        adBusy = false;
        resolve();
      };
      // Пока реклама не открылась, ждём недолго: SDK мог промолчать вовсе.
      guard = setTimeout(finish, AD_OPEN_TIMEOUT_MS);
      fireAndForget(
        'interstitial',
        () =>
          ysdk.adv.showFullscreenAdv({
            callbacks: {
              onOpen: () => {
                // Ролик на экране: сторож «не открылась» снимаем, иначе игра
                // продолжилась бы прямо под рекламой (п. 4.7). Взамен — длинный
                // сторож на случай, что onClose не придёт никогда.
                clearTimeout(guard);
                guard = setTimeout(finish, AD_CLOSE_TIMEOUT_MS);
                lastInterstitialAt = Date.now();
              },
              onClose: finish,
              onError: (e) => {
                console.warn('[sdk] interstitial:', e);
                finish();
              },
            },
          }),
        finish,
      )
    });
  },

  /**
   * Реклама за вознаграждение. Возвращает true, только если игрок
   * действительно досмотрел ролик (onRewarded).
   */
  showRewarded() {
    if (!embedded()) {
      // Вне площадки рекламы физически нет — иначе подсказку не протестировать.
      console.info('[sdk] rewarded вне площадки: награда выдана без ролика');
      return Promise.resolve(true);
    }
    // На площадке без SDK награды нет. Раньше здесь стоял тот же
    // `Promise.resolve(true)`, и подсказку получал даром любой, у кого SDK не
    // поднялся или вырезан блокировщиком (п.4.5).
    if (!ysdk?.adv) return Promise.resolve(false);
    if (adBusy) {
      console.warn('[sdk] rewarded: показ уже идёт, второй не начинаем');
      return Promise.resolve(false);
    }
    adBusy = true;
    return new Promise((resolve) => {
      let rewarded = false;
      let done = false;
      let guard;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        adBusy = false;
        // Награду выдаёт только onRewarded самого SDK: закрытый на первой
        // секунде ролик и любой сбой показа наградой не считаются (п. 4.5).
        resolve(rewarded);
      };
      guard = setTimeout(finish, AD_OPEN_TIMEOUT_MS);
      fireAndForget(
        'rewarded',
        () =>
          ysdk.adv.showRewardedVideo({
            callbacks: {
              onOpen: () => {
                clearTimeout(guard);
                guard = setTimeout(finish, AD_CLOSE_TIMEOUT_MS);
              },
              onRewarded: () => {
                rewarded = true;
              },
              onClose: finish,
              onError: (e) => {
                console.warn('[sdk] rewarded:', e);
                finish();
              },
            },
          }),
        finish,
      )
    });
  },

  /**
   * Личный рекорд по режимам. Хранится в облаке площадки
   * (`player.setData`) — тогда он переживает обновление страницы и едет
   * за игроком на другое устройство. Для неавторизованных SDK держит эти же
   * данные локально, так что отдельная ветка под гостя не нужна.
   * Вне площадки (локальная разработка) падаем на localStorage.
   */
  async loadBest() {
    return (await readBest()) ?? emptyBest();
  },

  /**
   * Сохраняет рекорд, если он побит.
   * @param {'total'|'icons'|'shots'|'timed'|'hardcore'} board ключ таблицы
   * @returns {Promise<boolean>} побит ли рекорд
   */
  async saveBest(board, score) {
    const best = await readBest();
    // Не прочитали — не пишем. setData кладёт объект целиком, поэтому запись
    // поверх непрочитанного затёрла бы рекорды остальных четырёх таблиц:
    // один таймаут getData стоил бы игроку всей коллекции.
    if (!best) {
      console.warn(`[sdk] saveBest: рекорды не прочитаны, ${board}=${score} не сохраняем`);
      return false;
    }
    if (score <= (best[board] ?? 0)) return false;

    const next = { ...best, [board]: score };
    next.sig = bestSignature(next);
    try {
      if (!ysdk) {
        localStorage.setItem(BEST_KEY, JSON.stringify(next));
        bestCache = next;
        return true;
      }
      // flush=true: не ждать, пока SDK соберёт пачку изменений — партия
      // закончилась, игрок может закрыть вкладку прямо сейчас.
      await withTimeout(getPlayer().then((p) => p.setData({ [BEST_KEY]: next }, true)), 'setData');
      // Кэш двигаем только после удачной записи: иначе не сохранившийся рекорд
      // считался бы сохранённым до конца сессии и блокировал повторную попытку.
      bestCache = next;
      return true;
    } catch (e) {
      console.warn('[sdk] saveBest:', e?.message ?? e);
      return false;
    }
  },

  /**
   * Отправляет результат в лидерборд таблицы. Требует авторизации игрока.
   *
   * Отправляем только то, что лучше уже записанного. Площадка максимума не
   * хранит: `setScore` перезаписывает строку игрока любым присланным числом,
   * в том числе меньшим — и слабая партия сбрасывала рекорд, набитый раньше
   * (15000 в топе превращались в 300 после неудачного забега).
   *
   * @param {'total'|'icons'|'shots'|'timed'|'hardcore'} board ключ таблицы
   * @param {number} [knownBest] личный рекорд ДО этой партии. Запасное
   *   сравнение на случай, когда свою строку в таблице прочитать не удалось.
   * @param {object} stats сводка партии (Game.summary()) — уходит подписанной
   *   в extraData; без неё или с невозможными цифрами не отправляем
   */
  async submitScore(board, score, knownBest, stats) {
    const name = LEADERBOARD[board];
    if (!leaderboards || !name || score <= 0) return;
    // Быстрее секунды на вопрос или больше очков, чем даёт правило, — это не
    // партия, а бот на нашем интерфейсе. Такое не отправляем и не показали бы.
    if (!stats || !plausible(score, stats)) {
      console.warn(`[sdk] submitScore: ${name} — сводка партии неправдоподобна, не отправляем`, stats);
      return;
    }
    try {
      const player = await getPlayer();
      if (player.getMode() === 'lite') {
        // Площадка принимает результаты только от авторизованных игроков.
        console.info('[sdk] submitScore: игрок не вошёл в аккаунт, результат не отправлен');
        return;
      }
      // Своя строка в таблице авторитетнее личного рекорда: игрок мог играть
      // на другом устройстве или ещё до того, как рекорд стали хранить.
      const current = await playerEntry(name);
      // Своя строка без подписи — из версии до подписей или из консоли: видна
      // она не будет, и подписанный результат её перезаписывает, даже
      // меньший. Иначе честный игрок со старым высоким рекордом пропал бы из
      // таблицы, пока его не побьёт.
      const floor = current ? (current.verified ? current.score : 0) : (knownBest ?? (await readBest())?.[board]);
      // Ни строки в таблице, ни облачного рекорда — сравнить не с чем.
      // setScore пишет что дадут, поэтому молчим: пропущенная отправка стоит
      // одной партии, а отправка вслепую — всего накопленного рекорда.
      if (floor == null) {
        console.warn(`[sdk] submitScore: ${name} — не с чем сравнить, не отправляем`);
        return;
      }
      if (score <= floor) {
        console.info(`[sdk] submitScore: ${name} — ${score} не лучше ${floor}, не отправляем`);
        return;
      }
      await withTimeout(
        callLeaderboard('setScore', 'setLeaderboardScore', name, score, signExtraData(score, stats)),
        'setScore',
      );
      console.info(`[sdk] submitScore: ${name} ← ${score}`);
    } catch (e) {
      console.warn('[sdk] submitScore:', e?.message ?? e);
    }
  },

  /**
   * Итог партии: личный рекорд в облако и результат в лидерборд.
   *
   * Одним методом, а не двумя вызовами со стороны игры: рекорд ДО партии надо
   * прочитать раньше, чем его перепишет saveBest, — иначе лидерборду не с чем
   * сравнивать, если своя строка не прочиталась.
   *
   * @param {'total'|'icons'|'shots'|'timed'|'hardcore'} board ключ таблицы
   * @param {object} stats сводка партии (Game.summary()) для подписи
   * @returns {Promise<boolean>} побит ли личный рекорд
   */
  async recordResult(board, score, stats) {
    // Именно readBest, а не loadBest: последний подставляет нули, когда чтение
    // не удалось, и такой «рекорд 0» разрешил бы отправку слабой партии.
    const prevBest = (await readBest())?.[board];
    const [isRecord] = await Promise.all([
      sdk.saveBest(board, score),
      sdk.submitScore(board, score, prevBest, stats),
    ]);
    return isRecord;
  },

  /**
   * Топ игроков в лидерборде таблицы и соседи игрока по ней.
   *
   * Строки без верной подписи (см. verifyEntry) чужие — прячем: на площадке
   * они остаются, но таблицу показывает только наша игра. Своя строка видна
   * всегда, с флагом verified=false — игрок видит, что его результат не
   * подтверждён.
   *
   * @param {'total'|'icons'|'shots'|'timed'|'hardcore'} board ключ таблицы
   * @returns {Promise<{entries: Array, around: Array, hidden: number, available: boolean, error?: string}>}
   *   entries — топ, around — соседи игрока за пределами топа, hidden —
   *   сколько строк спрятано. available=false, если лидерборды недоступны —
   *   например, игра открыта не на площадке; в error — причина.
   */
  async topScores(board, limit = 10) {
    const name = LEADERBOARD[board];
    if (!leaderboards || !name) {
      return { entries: [], around: [], hidden: 0, available: false, error: 'объект лидербордов недоступен' };
    }
    try {
      // Игрок нужен, чтобы подсветить его строку. Не загрузился — просто
      // не будет подсветки, таблица показывается в любом случае.
      const player = await getPlayer().catch(() => null);
      const myId = player?.getUniqueID?.() ?? null;
      const res = await withTimeout(
        callLeaderboard('getEntries', 'getLeaderboardEntries', name, {
          quantityTop: limit,
          includeUser: true,
          // Соседи игрока по таблице — для блока «Рядом с тобой».
          quantityAround: 2,
        }),
        'getEntries',
      );
      // Топ и соседи приходят одним списком; строка игрока может быть в обоих.
      const seen = new Set();
      const all = [];
      for (const e of res?.entries ?? []) {
        const id = e.player?.uniqueID ?? `rank-${e.rank}`;
        if (seen.has(id)) continue;
        seen.add(id);
        all.push({
          rank: e.rank,
          score: e.score,
          name: e.player?.publicName || 'Игрок',
          self: Boolean(myId && e.player?.uniqueID === myId),
          verified: verifyEntry(e.score, e.extraData),
        });
      }
      const shown = all.filter((e) => e.verified || e.self).sort((a, b) => a.rank - b.rank);
      // Номера — по видимым строкам: с платформенным rank топ начинался бы с
      // «3.», когда две строки над ним спрятаны. У соседей за пределами топа
      // спрятанные между ними и топом неизвестны — вычитаем только спрятанное
      // в топе, rank площадки остаётся в поле rank.
      const hiddenInTop = all.filter((e) => e.rank <= limit && !(e.verified || e.self)).length;
      return {
        entries: shown.filter((e) => e.rank <= limit).map((e, i) => ({ ...e, place: i + 1 })),
        around: shown.filter((e) => e.rank > limit).map((e) => ({ ...e, place: e.rank - hiddenInTop })),
        hidden: all.length - shown.length,
        available: true,
      };
    } catch (e) {
      const error = e?.message ?? String(e);
      console.warn('[sdk] topScores:', error);
      return { entries: [], around: [], hidden: 0, available: false, error };
    }
  },
};
