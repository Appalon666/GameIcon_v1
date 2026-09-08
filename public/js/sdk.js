/**
 * Обёртка над SDK Яндекс Игр.
 * Вне площадки (локальная разработка) SDK нет — тогда все методы работают
 * как заглушки, чтобы игру можно было спокойно тестировать в браузере.
 */

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
 * Яндекс требует не меньше 60 секунд между межстраничными показами: более
 * частые вызовы площадка просто игнорирует. Держим свой счётчик, чтобы не
 * дёргать SDK впустую и не сбивать ритм игры.
 */
const INTERSTITIAL_COOLDOWN_MS = 60_000;
let lastInterstitialAt = 0;

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
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: таймаут ${ms} мс`)), ms)),
  ]);
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

/** Рекорд вне площадки: SDK нет, храним в браузере. */
function readLocalBest() {
  try {
    return coerceBest(JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}'));
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
    try {
      ysdk.features?.LoadingAPI?.ready();
    } catch (e) {
      console.warn('[sdk] LoadingAPI.ready:', e?.message ?? e);
    }
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
    try {
      ysdk.features?.GameplayAPI?.start();
    } catch (e) {
      console.warn('[sdk] GameplayAPI.start:', e?.message ?? e);
    }
  },

  gameplayStop() {
    if (!ysdk) {
      pending.gameplay = 'stop';
      return;
    }
    try {
      ysdk.features?.GameplayAPI?.stop();
    } catch (e) {
      console.warn('[sdk] GameplayAPI.stop:', e?.message ?? e);
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
    // реклама вешала бы игру до 10-секундного сторожа.
    if (!embedded()) return Promise.resolve();
    if (opts.respectCooldown && !sdk.interstitialReady) return Promise.resolve();
    lastInterstitialAt = Date.now();
    if (!ysdk?.adv) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      // Страховка: если SDK не вызовет ни один колбэк, продолжаем через 10 с.
      const guard = setTimeout(finish, 10000);
      const end = () => {
        clearTimeout(guard);
        finish();
      };
      try {
        ysdk.adv.showFullscreenAdv({
          callbacks: {
            onClose: end,
            onError: (e) => {
              console.warn('[sdk] interstitial:', e);
              end();
            },
          },
        });
      } catch (e) {
        console.warn('[sdk] interstitial:', e?.message ?? e);
        end();
      }
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
    return new Promise((resolve) => {
      let rewarded = false;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(rewarded);
      };
      const guard = setTimeout(finish, 60000);
      const end = () => {
        clearTimeout(guard);
        finish();
      };
      try {
        ysdk.adv.showRewardedVideo({
          callbacks: {
            onRewarded: () => {
              rewarded = true;
            },
            onClose: end,
            onError: (e) => {
              console.warn('[sdk] rewarded:', e);
              end();
            },
          },
        });
      } catch (e) {
        console.warn('[sdk] rewarded:', e?.message ?? e);
        end();
      }
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
    // Рекорд меняется только отсюда же, поэтому после первого чтения держим
    // его в памяти: иначе каждая партия стоила бы лишних запросов в облако.
    if (bestCache) return bestCache;
    try {
      if (!ysdk) return (bestCache = readLocalBest());
      const data = await withTimeout(getPlayer().then((p) => p.getData([BEST_KEY])), 'getData');
      bestCache = coerceBest(data?.[BEST_KEY]);
    } catch (e) {
      console.warn('[sdk] loadBest:', e?.message ?? e);
      bestCache = emptyBest();
    }
    return bestCache;
  },

  /**
   * Сохраняет рекорд, если он побит.
   * @param {'total'|'icons'|'shots'|'timed'|'hardcore'} board ключ таблицы
   * @returns {Promise<boolean>} побит ли рекорд
   */
  async saveBest(board, score) {
    const best = await sdk.loadBest();
    if (score <= (best[board] ?? 0)) return false;
    bestCache = { ...best, [board]: score };
    try {
      if (!ysdk) {
        localStorage.setItem(BEST_KEY, JSON.stringify(bestCache));
        return true;
      }
      // flush=true: не ждать, пока SDK соберёт пачку изменений — партия
      // закончилась, игрок может закрыть вкладку прямо сейчас.
      await withTimeout(getPlayer().then((p) => p.setData({ [BEST_KEY]: bestCache }, true)), 'setData');
      return true;
    } catch (e) {
      console.warn('[sdk] saveBest:', e?.message ?? e);
      return false;
    }
  },

  /**
   * Отправляет результат в лидерборд таблицы. Требует авторизации игрока.
   * @param {'total'|'icons'|'shots'|'timed'|'hardcore'} board ключ таблицы
   */
  async submitScore(board, score) {
    const name = LEADERBOARD[board];
    if (!leaderboards || !name || score <= 0) return;
    try {
      const player = await getPlayer();
      if (player.getMode() === 'lite') {
        // Площадка принимает результаты только от авторизованных игроков.
        console.info('[sdk] submitScore: игрок не вошёл в аккаунт, результат не отправлен');
        return;
      }
      await withTimeout(callLeaderboard('setScore', 'setLeaderboardScore', name, score), 'setScore');
      console.info(`[sdk] submitScore: ${name} ← ${score}`);
    } catch (e) {
      console.warn('[sdk] submitScore:', e?.message ?? e);
    }
  },

  /**
   * Топ игроков в лидерборде таблицы.
   * @param {'total'|'icons'|'shots'|'timed'|'hardcore'} board ключ таблицы
   * @returns {Promise<{entries: Array, available: boolean, error?: string}>}
   *   available=false, если лидерборды недоступны — например, игра открыта не
   *   на площадке. В error — причина, её показываем в окне лидербордов.
   */
  async topScores(board, limit = 10) {
    const name = LEADERBOARD[board];
    if (!leaderboards || !name) {
      return { entries: [], available: false, error: 'объект лидербордов недоступен' };
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
        }),
        'getEntries',
      );
      const entries = (res?.entries ?? []).map((e) => ({
        rank: e.rank,
        score: e.score,
        name: e.player?.publicName || 'Игрок',
        self: Boolean(myId && e.player?.uniqueID === myId),
      }));
      return { entries, available: true };
    } catch (e) {
      const error = e?.message ?? String(e);
      console.warn('[sdk] topScores:', error);
      return { entries: [], available: false, error };
    }
  },
};
