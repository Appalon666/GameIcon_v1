/**
 * Игровая логика викторины «Угадай игру». Не знает ни про DOM, ни про SDK —
 * это делает main.js. Так логику проще держать в голове и тестировать.
 *
 * Игрок видит ярлык-иконку или скриншот игры и выбирает название из четырёх
 * вариантов. Неверные варианты берутся из того же жанра (и по возможности того
 * же тира узнаваемости), иначе вопрос «Dota 2 или какой-то инди-платформер?»
 * решался бы по стилю картинки, а не по знанию игры.
 */

export const LIVES = 3;
export const OPTIONS = 4;
/* Очки крупным масштабом: сотня за ответ и бонус за серию в тех же пропорциях.
   Мелкий масштаб (10/2/10) обесценил бы рекорды, уже набитые в облачных
   таблицах, — догонять их пришлось бы вдесятеро дольше. */
const BASE_POINTS = 100;
const STREAK_BONUS = 20;
const MAX_STREAK_BONUS = 100;

/** Режимы игры. */
export const MODE = {
  /** Три жизни, времени нет. */
  NORMAL: 'normal',
  /** 10 секунд на вопрос: не успел или ошибся — партия окончена. */
  TIMED: 'timed',
  /** Одна жизнь: первая ошибка заканчивает партию. Возрождения нет. */
  HARDCORE: 'hardcore',
};

/** Жизней в режиме Hardcore. */
const HARDCORE_LIVES = 1;

/** Тип контента вопроса. */
export const KIND = {
  ICON: 'icon',
  SHOT: 'shot',
  /** И иконки, и скриншоты вперемешку. */
  MIX: 'mix',
};

/**
 * Таблицы лидербордов. Обычный режим разбит на три по типу контента
 * (общий зачёт по всему, только по иконкам, только по скриншотам), а «на время»
 * и «хардкор» — по одной таблице на режим независимо от типа картинок.
 * Ключи совпадают с полями рекорда в облаке и с ключами карты LEADERBOARD в sdk.js.
 */
export const BOARD = {
  TOTAL: 'total',
  ICONS: 'icons',
  SHOTS: 'shots',
  TIMED: 'timed',
  HARDCORE: 'hardcore',
};

/**
 * Таблица лидерборда для пары «режим × тип контента». Тип контента разводит
 * по таблицам только в обычном режиме; «на время» и «хардкор» всегда идут
 * в свою единственную таблицу.
 * @param {'normal'|'timed'|'hardcore'} mode
 * @param {'icon'|'shot'|'mix'} kind
 * @returns {'total'|'icons'|'shots'|'timed'|'hardcore'}
 */
export function boardFor(mode, kind) {
  if (mode === MODE.TIMED) return BOARD.TIMED;
  if (mode === MODE.HARDCORE) return BOARD.HARDCORE;
  if (kind === KIND.ICON) return BOARD.ICONS;
  if (kind === KIND.SHOT) return BOARD.SHOTS;
  return BOARD.TOTAL;
}

/**
 * Время в режиме «на время», мс. Отсчёт идёт не на всю партию, а на каждый
 * вопрос: таймер заводится заново с приходом новой картинки.
 */
export const TIME = {
  PER_QUESTION: 10_000,
};

/**
 * Прогрессия сложности: чем дальше игрок прошёл, тем реже попадаются
 * массовые игры и тем чаще нишевые.
 *
 * `upTo` — номер вопроса, до которого действует этап (включительно).
 * `weights` — вероятности тиров в процентах внутри этапа.
 *
 * Если у какого-то тира нет данных (например, выбран жанр, где нет раритета),
 * его вес перераспределяется между остальными тирами этапа — игра не должна
 * вставать из-за нехватки данных.
 */
export const STAGES = [
  { upTo: 30, weights: { 1: 100 } },
  { upTo: 70, weights: { 1: 40, 2: 60 } },
  { upTo: 129, weights: { 1: 10, 2: 40, 3: 50 } },
  { upTo: 200, weights: { 2: 10, 3: 40, 4: 50 } },
  { upTo: Infinity, weights: { 3: 20, 4: 80 } },
];

/** Этап сложности для вопроса с этим номером (нумерация с единицы). */
export function stageFor(questionNumber) {
  return STAGES.find((s) => questionNumber <= s.upTo) ?? STAGES[STAGES.length - 1];
}

/** Перемешивание Фишера—Йетса. */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Game {
  /**
   * @param {Array} items записи медиа (иконки/скриншоты) из icons.json + shots.json
   * @param {Array} games записи игр из games.json
   */
  constructor(items, games) {
    this.gameById = new Map(games.map((g) => [g.id, g]));

    // Играем медиа, проверенные глазами: либо название на картинке замазано
    // рамками, либо кадр помечен как «чистый» — названия на нём не видно.
    // Брак исключаем.
    this.allItems = items.filter((it) => (it.blur?.length || it.clean) && !it.skip);

    // Фильтры активной партии (тип контента и жанр) задаёт reset().
    this.reset();
  }

  /** Список жанров, по которым реально есть с чем играть (для меню). */
  genresAvailable(kind = KIND.MIX) {
    const set = new Set();
    for (const it of this.allItems) {
      if (kind !== KIND.MIX && it.kind !== kind) continue;
      const g = this.gameById.get(it.gameId);
      if (g?.genre) set.add(g.genre);
    }
    return [...set];
  }

  /** Хватает ли данных для выбранных фильтров, чтобы начать партию. */
  get ready() {
    return this.items.length > 0 && this.playableGameIds.length >= OPTIONS;
  }

  /**
   * @param {'normal'|'timed'|'hardcore'} mode
   * @param {{kind?: string, genre?: string|null}} [opts]
   */
  reset(mode = MODE.NORMAL, { kind = KIND.MIX, genre = null } = {}) {
    this.mode = mode;
    this.kind = kind;
    this.genre = genre;
    // Сколько жизней у режима (для отрисовки сердец). В «на время» их нет.
    this.maxLives = mode === MODE.HARDCORE ? HARDCORE_LIVES : LIVES;
    this.lives = mode === MODE.TIMED ? 0 : this.maxLives;
    this.timeLeft = mode === MODE.TIMED ? TIME.PER_QUESTION : 0;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.asked = 0;
    this.correctCount = 0;

    // Отбираем медиа под тип контента и жанр текущей партии.
    this.items = this.allItems.filter((it) => {
      if (kind !== KIND.MIX && it.kind !== kind) return false;
      if (genre && this.gameById.get(it.gameId)?.genre !== genre) return false;
      return true;
    });

    // Варианты ответа берём только из игр, у которых есть подходящее медиа,
    // иначе неверные варианты выглядели бы как игры «без картинки».
    this.playableGameIds = [...new Set(this.items.map((it) => it.gameId))];
    this.playableGames = this.playableGameIds.map((id) => this.gameById.get(id)).filter(Boolean);

    // Раскладка игр по тирам — для подбора неверных вариантов того же тира.
    this.byTier = new Map();
    for (const g of this.playableGames) {
      const tier = g.tier ?? 3;
      if (!this.byTier.has(tier)) this.byTier.set(tier, []);
      this.byTier.get(tier).push(g.id);
    }

    // Медиа тоже по тирам: у каждого тира своя колода, чтобы кадры внутри тира
    // не повторялись, пока не кончатся все.
    this.itemsByTier = new Map();
    for (const it of this.items) {
      const tier = this.gameById.get(it.gameId)?.tier ?? 3;
      if (!this.itemsByTier.has(tier)) this.itemsByTier.set(tier, []);
      this.itemsByTier.get(tier).push(it);
    }

    // По колоде на тир, каждая со своей позицией.
    this.decks = new Map();
    for (const [tier, list] of this.itemsByTier) {
      this.decks.set(tier, { cars: shuffle(list), pos: 0 });
    }
    /** Игры, уже попадавшиеся в этой партии: одна игра — один вопрос. */
    this.usedGames = new Set();
    /** Медиа, заготовленное для следующего вопроса (нужно для предзагрузки). */
    this.upcoming = null;
    this.question = null;
    this.over = false;
    /** Возрождение за рекламу — один раз за партию и только в обычном режиме. */
    this.reviveUsed = false;
  }

  /**
   * Можно ли предложить возрождение: только в обычном режиме, когда жизни
   * кончились, а ролик ещё не смотрели. В Hardcore второго шанса нет — в этом
   * и смысл режима; в «на время» жизней нет вовсе.
   */
  get canRevive() {
    return this.mode === MODE.NORMAL && this.over && !this.reviveUsed;
  }

  /**
   * Возвращает игрока в партию с полным запасом жизней. Очки и статистика
   * сохраняются — это продолжение той же партии, а не новая.
   * @returns {boolean} получилось ли
   */
  revive() {
    if (!this.canRevive) return false;
    this.reviveUsed = true;
    this.lives = LIVES;
    this.over = false;
    return true;
  }

  /**
   * Выбирает тир для вопроса по прогрессии сложности.
   * Веса этапа перераспределяются только между тирами, у которых есть медиа.
   * @param {number} questionNumber номер вопроса, с единицы
   * @returns {number} номер тира
   */
  pickTier(questionNumber) {
    const { weights } = stageFor(questionNumber);
    const available = [...this.decks.keys()].filter((t) => this.decks.get(t).cars.length);

    const pool = available
      .filter((t) => weights[t] > 0)
      .map((t) => ({ tier: t, weight: weights[t] }));

    if (!pool.length) {
      const target = Number(Object.keys(weights)[0]);
      return available.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    }

    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * total;
    for (const p of pool) {
      roll -= p.weight;
      if (roll < 0) return p.tier;
    }
    return pool[pool.length - 1].tier;
  }

  /**
   * Берёт из колоды тира первое медиа, игра которого ещё не попадалась.
   * @param {number} tier
   * @param {boolean} freshGameOnly требовать новую игру
   * @returns {object|null}
   */
  takeFromDeck(tier, freshGameOnly) {
    const deck = this.decks.get(tier);
    if (!deck?.cars.length) return null;

    if (deck.pos >= deck.cars.length) {
      deck.cars = shuffle(deck.cars);
      deck.pos = 0;
    }

    // Два прохода: сначала от текущей позиции до конца, потом с начала после
    // перетасовки — иначе подходящие карты позади позиции считались бы
    // недоступными, и тир «заканчивался» раньше времени.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = deck.pos; i < deck.cars.length; i++) {
        const item = deck.cars[i];
        if (freshGameOnly && this.usedGames.has(item.gameId)) continue;
        [deck.cars[deck.pos], deck.cars[i]] = [deck.cars[i], deck.cars[deck.pos]];
        deck.pos++;
        this.usedGames.add(item.gameId);
        return item;
      }
      if (deck.pos === 0) break;
      deck.cars = shuffle(deck.cars);
      deck.pos = 0;
    }
    return null;
  }

  /**
   * Достаёт следующее медиа. Одна игра за партию встречается один раз: когда
   * непопадавшихся игр не остаётся, начинается новый круг.
   * @param {number} questionNumber номер вопроса, с единицы
   * @returns {object|null}
   */
  drawItem(questionNumber) {
    if (!this.decks.size) return null;

    const attempt = () => {
      const first = this.pickTier(questionNumber);
      const order = [
        first,
        ...[...this.decks.keys()]
          .filter((t) => t !== first)
          .sort((a, b) => Math.abs(a - first) - Math.abs(b - first)),
      ];
      for (const tier of order) {
        const item = this.takeFromDeck(tier, true);
        if (item) return item;
      }
      return null;
    };

    const item = attempt();
    if (item) return item;

    this.usedGames.clear();
    return attempt() ?? this.takeFromDeck(this.pickTier(questionNumber), false);
  }

  get isTimed() {
    return this.mode === MODE.TIMED;
  }

  get isHardcore() {
    return this.mode === MODE.HARDCORE;
  }

  /** Таблица лидерборда текущей партии (см. {@link boardFor}). */
  get board() {
    return boardFor(this.mode, this.kind);
  }

  /**
   * Списывает прошедшее время в режиме «на время» из запаса текущего вопроса.
   * @param {number} ms сколько прошло с прошлого вызова
   * @returns {boolean} закончилось ли время именно сейчас
   */
  tick(ms) {
    if (!this.isTimed || this.over || ms <= 0) return false;
    this.timeLeft -= ms;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.over = true;
      return true;
    }
    return false;
  }

  get isOver() {
    return this.over;
  }

  /** Игрок сам прервал партию (вышел в меню). */
  abandon() {
    this.over = true;
    this.question = null;
    this.upcoming = null;
  }

  /**
   * Подбирает неверные варианты: сначала того же жанра и тира, потом того же
   * жанра, потом того же тира, потом любые. Так вопрос остаётся честным —
   * варианты близки по жанру (не выдают ответ стилем картинки) и по
   * узнаваемости (нельзя ткнуть в «единственную известную» игру).
   * @returns {string[]}
   */
  pickDistractors(correctId) {
    const correct = this.gameById.get(correctId);
    const genre = correct?.genre;
    const tier = correct?.tier ?? 3;
    const banned = new Set([correctId, ...(correct?.conflicts ?? [])]);

    const pools = [
      this.playableGames.filter((g) => g.genre === genre && g.tier === tier),
      this.playableGames.filter((g) => g.genre === genre),
      (this.byTier.get(tier) ?? []).map((id) => this.gameById.get(id)),
      this.playableGames,
    ];

    const picked = [];
    for (const pool of pools) {
      for (const g of shuffle(pool)) {
        if (picked.length === OPTIONS - 1) break;
        if (!g || banned.has(g.id)) continue;
        picked.push(g.id);
        banned.add(g.id);
      }
      if (picked.length === OPTIONS - 1) break;
    }
    return picked;
  }

  /** Готовит следующий вопрос. */
  nextQuestion() {
    if (this.over) return null;

    const item = this.upcoming ?? this.drawItem(this.asked + 1);
    this.upcoming = null;
    if (!item) return null;

    // Каждому вопросу — свой полный запас времени.
    if (this.isTimed) this.timeLeft = TIME.PER_QUESTION;

    const wrong = this.pickDistractors(item.gameId);
    const options = shuffle([item.gameId, ...wrong]).map((id) => this.gameById.get(id));

    this.question = {
      item,
      options,
      correctId: item.gameId,
      answeredId: null,
      hidden: [],
      hintUsed: false,
      resolved: false,
    };
    this.asked++;
    return this.question;
  }

  /**
   * Отменяет выданный вопрос — например, когда картинка не загрузилась.
   * Без этого битые кадры раздували счётчик заданных вопросов, портя
   * статистику и сбивая ритм рекламы «каждые N картинок».
   */
  discardQuestion() {
    if (!this.question || this.question.resolved) return;
    this.asked--;
    this.question = null;
  }

  /**
   * Медиа, которое достанется следующему вопросу, — для предзагрузки.
   * @returns {object|null}
   */
  peekNext() {
    if (this.over || !this.items.length) return null;
    if (!this.upcoming) this.upcoming = this.drawItem(this.asked + 1);
    return this.upcoming;
  }

  /**
   * Подсказка 50/50: убирает два неверных варианта.
   * @returns {string[]} id убранных игр
   */
  useFiftyFifty() {
    const q = this.question;
    if (!q || q.resolved || q.hintUsed) return [];

    const wrong = q.options.filter((g) => g.id !== q.correctId).map((g) => g.id);
    q.hidden = shuffle(wrong).slice(0, 2);
    q.hintUsed = true;
    return q.hidden;
  }

  /**
   * Обрабатывает ответ игрока.
   * @returns {{correct:boolean, gained:number, correctId:string, lives:number, over:boolean}}
   */
  answer(gameId) {
    const q = this.question;
    if (!q || q.resolved) throw new Error('нет активного вопроса');

    q.resolved = true;
    q.answeredId = gameId;
    const correct = gameId === q.correctId;
    let gained = 0;

    if (correct) {
      gained = BASE_POINTS + Math.min(this.streak * STREAK_BONUS, MAX_STREAK_BONUS);
      this.score += gained;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.correctCount++;
    } else {
      this.streak = 0;
      if (this.isTimed) {
        // Жизней в «на время» нет: ресурс режима — секунды, и неверный ответ
        // стоит ровно столько же, сколько просроченный, то есть партию.
        this.timeLeft = 0;
        this.over = true;
      } else {
        this.lives--;
        if (this.lives <= 0) {
          this.lives = 0;
          this.over = true;
        }
      }
    }

    return {
      correct,
      gained,
      correctId: q.correctId,
      lives: this.lives,
      over: this.over,
    };
  }
}
