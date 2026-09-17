/** Связывает игровую логику, отрисовку картинки и SDK Яндекс Игр с DOM. */
import { sdk } from './sdk.js';
import { Game, MODE, KIND, BOARD, TIME } from './game.js';
import { drawItem, loadImage } from './render.js';
import { icon, setIcon } from './icons.js';
import { music } from './audio.js';

/** Папка с картинками по типу контента. */
const IMG = { icon: 'img/icons/', shot: 'img/shots/' };
const srcOf = (item) => IMG[item.kind] + item.file;

/** Названия таблиц лидербордов для интерфейса. */
const BOARD_LABEL = {
  [BOARD.TOTAL]: 'Общий · Всё',
  [BOARD.ICONS]: 'Общий · Иконки',
  [BOARD.SHOTS]: 'Общий · Скриншоты',
  [BOARD.TIMED]: 'На время',
  [BOARD.HARDCORE]: 'Хардкор',
};
/** Короткие подписи типа контента — для строки «Таблица: Общий · …» под режимом. */
const KIND_LABEL = { [KIND.MIX]: 'Всё', [KIND.ICON]: 'Иконки', [KIND.SHOT]: 'Скриншоты' };

/** Через сколько вопросов показывать межстраничную рекламу. */
const ADS_EVERY = 5;
/** Шаг таймера в режиме «на время», мс. */
const TICK_MS = 100;

const $ = (id) => document.getElementById(id);
const el = {
  boot: $('boot'),
  bootText: $('boot-text'),
  start: $('screen-start'),
  game: $('screen-game'),
  over: $('screen-over'),
  kind: $('kind'),
  lives: $('lives'),
  timer: $('timer'),
  timerFill: $('timer-fill'),
  timerValue: $('timer-value'),
  timerIcon: $('timer-icon'),
  score: $('score'),
  scoreIcon: $('score-icon'),
  hintIcon: $('hint-icon'),
  homeIcon: $('home-icon'),
  home: $('btn-home'),
  sound: $('btn-sound'),
  soundIcon: $('sound-icon'),
  soundMenu: $('btn-sound-menu'),
  soundIconMenu: $('sound-icon-menu'),
  gain: $('gain'),
  canvas: $('canvas'),
  shortcutLabel: $('shortcut-label'),
  status: $('status'),
  reveal: $('reveal'),
  revealVerdict: $('reveal-verdict'),
  revealAnswer: $('reveal-answer'),
  revealFact: $('reveal-fact'),
  next: $('btn-next'),
  revive: $('btn-revive'),
  options: $('options'),
  hint: $('btn-hint'),
  play: $('btn-play'),
  playTimed: $('btn-play-timed'),
  playHard: $('btn-play-hard'),
  again: $('btn-again'),
  boards: $('boards'),
  boardsList: $('boards-list'),
  boardsNote: $('boards-note'),
  boardsOpen: $('btn-board'),
  boardsClose: $('btn-boards-close'),
  tabTotal: $('tab-total'),
  tabIcons: $('tab-icons'),
  tabShots: $('tab-shots'),
  tabTimed: $('tab-timed'),
  tabHardcore: $('tab-hardcore'),
  modeBoardNormal: $('mode-board-normal'),
  modeBoardTimed: $('mode-board-timed'),
  modeBoardHard: $('mode-board-hard'),
  finalScore: $('final-score'),
  stats: $('stats'),
  board: $('board'),
  boardList: $('board-list'),
  records: $('records'),
  menuBoard: $('menu-board'),
  menuBoardList: $('menu-board-list'),
  credits: $('credits'),
  creditsOpen: $('btn-credits'),
  creditsClose: $('btn-credits-close'),
};

/**
 * Исходное содержимое кнопки возрождения: на неё временно пишем причину отказа
 * («ролик не досмотрен»), а к следующему разбору возвращаем как было.
 */
const REVIVE_LABEL = [...el.revive.childNodes].map((n) => n.cloneNode(true));

/** @type {Game} */
let game;
/** @type {HTMLImageElement|null} */
let currentImg = null;
let busy = false;
let timerId = null;
let lastTickAt = 0;
/** Ключ таблицы, открытой сейчас в окне «Лидерборды». */
let boardKey = BOARD.TOTAL;

/**
 * Номер партии. Растёт на каждом старте и выходе в меню: асинхронные хвосты
 * (реклама, запросы к площадке) сверяются с ним, чтобы не дорисовать итоги уже
 * брошенной партии поверх меню.
 */
let runId = 0;

/** Выбор типа контента на главном экране. */
let selKind = KIND.MIX;

function show(screen) {
  for (const s of [el.start, el.game, el.over]) s.hidden = s !== screen;
}

async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/* ---------- Отрисовка состояния ---------- */

function renderLives() {
  el.lives.hidden = game.isTimed;
  el.timer.hidden = !game.isTimed;
  if (game.isTimed) return;

  el.lives.textContent = '';
  for (let i = 0; i < game.maxLives; i++) {
    const life = document.createElement('span');
    life.className = i < game.lives ? 'hud__life' : 'hud__life hud__life--lost';
    life.append(icon('heart', { size: 22 }));
    el.lives.append(life);
  }
  el.lives.setAttribute('aria-label', `Жизней осталось: ${game.lives} из ${game.maxLives}`);
}

/* ---------- Таймер режима «на время» ---------- */

function renderTimer() {
  if (!game.isTimed) return;
  const seconds = game.timeLeft / 1000;
  el.timerValue.textContent = String(Math.ceil(seconds));

  const share = Math.min(1, game.timeLeft / TIME.PER_QUESTION);
  el.timerFill.style.width = `${(share * 100).toFixed(1)}%`;
  el.timer.classList.toggle('timer--low', seconds <= 3);
  el.timer.setAttribute('aria-label', `Осталось секунд: ${Math.ceil(seconds)}`);
}

function startTimer() {
  if (!game.isTimed || timerId !== null) return;
  lastTickAt = Date.now();
  timerId = setInterval(() => {
    const now = Date.now();
    const delta = now - lastTickAt;
    lastTickAt = now;

    const ranOut = game.tick(delta);
    renderTimer();
    if (ranOut) {
      stopTimer();
      onTimeOver();
    }
  }, TICK_MS);
}

function stopTimer() {
  if (timerId === null) return;
  clearInterval(timerId);
  timerId = null;
}

/* ---------- Пауза партии (вкладка, реклама, паузы площадки) ---------- */

/**
 * Причины паузы. Партия идёт, только когда не осталось ни одной: иначе реклама,
 * закончившаяся под свёрнутой вкладкой, вернула бы игру в ход прямо в фоне.
 * Обратная сторона счётчика — забытая причина означает вечную паузу, поэтому
 * каждой есть чем сняться: у HIDDEN сторож ниже (событие возврата может не
 * прийти совсем), у AD — таймауты внутри sdk.js, у PLATFORM — game_api_resume.
 */
const PAUSE = { HIDDEN: 'hidden', AD: 'ad', PLATFORM: 'platform' };
const pauseReasons = new Set();

/**
 * Сколько ждём game_api_resume, прежде чем снять паузу площадки самим.
 * У каждой причины паузы должен быть свой срок: колбэк снятия может не прийти
 * совсем, и тогда партия встанет навсегда при живом экране (п. 1.14). Срок
 * заведомо длиннее любого системного оверлея и ролика площадки.
 */
const PLATFORM_PAUSE_TIMEOUT_MS = 180_000;
let platformPauseTimer = null;

/** Вопрос показан целиком (картинка нарисована) и ещё не отвечен. */
let questionLive = false;

/**
 * Идёт ли геймплей с точки зрения площадки. GameplayAPI ждёт парных вызовов, а
 * зовём мы их из четырёх мест (пауза, разбор, старт партии, выход в меню) —
 * без этого флага по два `start` подряд уходило бы на каждый вопрос.
 */
let gameplayRunning = false;

function gameplayStart() {
  if (gameplayRunning) return;
  gameplayRunning = true;
  sdk.gameplayStart();
}

function gameplayStop() {
  if (!gameplayRunning) return;
  gameplayRunning = false;
  sdk.gameplayStop();
}

function addPause(reason) {
  if (pauseReasons.has(reason)) return;
  pauseReasons.add(reason);
  if (pauseReasons.size > 1) return;
  gameplayStop();
  stopTimer();
  // Скрытая вкладка (п. 1.3) и полноэкранная реклама (п. 4.7) обязаны глушить
  // звук. Причины считаются здесь же — своего списка у музыки нет намеренно.
  music.pause();
}

function dropPause(reason) {
  if (!pauseReasons.delete(reason) || pauseReasons.size) return;
  // Музыка возвращается до проверок на экран: она играет и в меню, и на
  // разборе ответа, где геймплея нет.
  music.resume();
  if (el.game.hidden || game.isOver || !el.reveal.hidden) return;
  resumeGameplay();
  // Таймер поднимаем, только если вопрос уже на экране: пока грузится картинка,
  // его запустит сам nextQuestion().
  if (questionLive) startTimer();
}

/**
 * Говорит площадке, что геймплей снова идёт. Отдельной функцией, потому что
 * gameplayStop() уходит на каждую паузу, а парного start звать было некому,
 * если пауза снялась на разборе: dropPause там выходит раньше, и до конца
 * партии площадка считала, что игры нет. Зовём и когда вопрос встал на экран.
 */
function resumeGameplay() {
  if (pauseReasons.size || el.game.hidden || game.isOver) return;
  gameplayStart();
}

/** Время вышло: показываем правильный ответ и итоги. */
function onTimeOver() {
  if (!game.question || game.question.resolved) return;
  busy = true;
  questionLive = false;
  for (const btn of optionButtons()) btn.disabled = true;
  el.hint.disabled = true;
  showReveal({
    correct: false,
    gained: 0,
    correctId: game.question.correctId,
    over: true,
    timeOut: true,
  });
}

/** Перезапускает всплывающую анимацию прибавки. */
function flashGain(node, text) {
  node.textContent = text;
  node.classList.remove('score__gain--show');
  void node.offsetWidth;
  node.classList.add('score__gain--show');
}

function renderScore(gained = 0) {
  el.score.textContent = String(game.score);
  if (gained > 0) flashGain(el.gain, `+${gained}`);
}

function setStatus(text) {
  el.status.textContent = text;
  el.status.hidden = !text;
}

function renderOptions(question) {
  el.options.textContent = '';
  for (const g of question.options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn option';
    btn.textContent = g.name;
    btn.dataset.gameId = g.id;
    // Включим, когда картинка вопроса окажется на экране: до этого момента
    // варианты уже новые, а кадр ещё старый — и нажатие всё равно
    // проглатывается по busy.
    btn.disabled = true;
    btn.addEventListener('click', () => onAnswer(g.id));
    el.options.append(btn);
  }
}

function optionButtons() {
  return [...el.options.querySelectorAll('.option')];
}

/* ---------- Звук ---------- */

/**
 * Обе кнопки звука (в меню и в верхней панели игры) показывают одно состояние.
 * Отдельной функцией, потому что состояние меняется не только по клику: музыка
 * зовёт её же, когда сама решила, что играть пока нельзя.
 */
function renderSound() {
  const off = music.muted;
  const label = off ? 'Включить звук' : 'Выключить звук';
  for (const [btn, host] of [[el.sound, el.soundIcon], [el.soundMenu, el.soundIconMenu]]) {
    setIcon(host, off ? 'mute' : 'sound', { size: btn === el.sound ? 18 : 16 });
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(off));
    btn.classList.toggle('is-off', off);
  }
}

/* ---------- Ход игры ---------- */

const MAX_LOAD_FAILURES = 8;

async function nextQuestion() {
  if (el.game.hidden || game.isOver) {
    busy = false;
    return;
  }

  busy = true;
  questionLive = false;
  el.reveal.hidden = true;

  for (let attempt = 0; attempt < MAX_LOAD_FAILURES; attempt++) {
    const q = game.nextQuestion();
    if (!q) break;

    // Пока картинка грузится, игра занята (busy) и нажатие на 50/50 всё равно
    // проглатывается — честнее показать это кнопкой, чем промолчать.
    el.hint.disabled = true;
    renderShortcut();
    renderLives();
    // Таймер вопроса заводится заново — показываем полный запас сразу, пока
    // грузится картинка, иначе в HUD доживали бы секунды прошлого вопроса.
    renderTimer();
    renderScore();
    renderOptions(q);
    setStatus('');

    try {
      const img = await loadImage(srcOf(q.item));
      // Пока грузилась картинка, партию могли бросить и начать новую — тогда
      // этот вопрос уже не наш. Без проверки на экран ложился кадр брошенной
      // партии, а варианты оставались от текущего вопроса: угадать нельзя.
      if (game.question !== q) return;
      currentImg = img;
      // Пропорции кадра двумя числами, а не дробью: из них CSS считает и
      // aspect-ratio рамки, и её предел по ширине (см. .photo).
      const frameStyle = el.canvas.parentElement.style;
      frameStyle.setProperty('--arw', String(currentImg.naturalWidth));
      frameStyle.setProperty('--arh', String(currentImg.naturalHeight));
      drawItem(el.canvas, currentImg, q.item.blur);
      playPhotoIntro();
      preloadNext();
      questionLive = true;
      for (const btn of optionButtons()) btn.disabled = false;
      resumeGameplay();
      startTimer();
      el.hint.disabled = false;
      busy = false;
      return;
    } catch (e) {
      if (game.question !== q) return;
      console.warn('[main]', e.message);
      game.discardQuestion();
    }
  }

  setStatus('Не удалось загрузить картинку. Проверь соединение.');
  el.hint.disabled = true;
  busy = false;
}

/** Полоска-заклейка поверх названия. */
function redactBar() {
  const bar = document.createElement('span');
  bar.className = 'redact';
  return bar;
}

/**
 * Готовит «ярлык» под новый вопрос: подпись под картинкой заклеена — там и
 * стоит ответ. Иконка и скриншот оформлены одинаково, разбора по типу нет.
 */
function renderShortcut() {
  el.shortcutLabel.className = 'shortcut__label';
  el.shortcutLabel.replaceChildren(redactBar());
}

/**
 * Снимает заклейку: ярлык «переименовывается» в правильный ответ. Название
 * появляется ровно там, где было спрятано, — под картинкой.
 */
function nameShortcut(name) {
  el.shortcutLabel.className = 'shortcut__label shortcut__label--named';
  el.shortcutLabel.textContent = name;
}

function playPhotoIntro() {
  const frame = el.canvas.parentElement;
  frame.classList.remove('photo--in');
  void frame.offsetWidth;
  frame.classList.add('photo--in');
}

function preloadNext() {
  const next = game.peekNext();
  if (!next) return;
  loadImage(srcOf(next)).catch(() => {});
}

function onAnswer(gameId) {
  if (busy || !game.question || game.question.resolved) return;
  // Вариант, убранный подсказкой, ответом не считается.
  if (game.question.hidden.includes(gameId)) return;
  busy = true;
  questionLive = false;
  stopTimer();

  const res = game.answer(gameId);
  el.hint.disabled = true;

  for (const btn of optionButtons()) {
    const id = btn.dataset.gameId;
    btn.disabled = true;
    if (id === res.correctId) btn.classList.add('option--correct');
    else if (id === gameId) btn.classList.add('option--wrong');
  }

  renderLives();
  renderTimer();
  renderScore(res.gained);
  showReveal(res);
}

/** Окно с правильным ответом и разработчиком. */
function showReveal(res) {
  const g = game.gameById.get(res.correctId);
  nameShortcut(g.name);

  el.revealVerdict.textContent = res.correct ? 'Верно!' : res.timeOut ? 'Время вышло' : 'Мимо';
  el.revealVerdict.className = `reveal__verdict ${
    res.correct ? 'reveal__verdict--good' : 'reveal__verdict--bad'
  }`;

  // Строка ответа: название · жанр · год.
  el.revealAnswer.textContent = '';
  const name = document.createElement('b');
  name.textContent = g.name;
  const sub = [g.genre, g.year].filter(Boolean).join(' · ');
  el.revealAnswer.append(
    document.createTextNode('Ответ: '),
    name,
    document.createTextNode(sub ? ` · ${sub}` : ''),
  );

  // Отдельный блок — разработчик. Прячем, если его нет в данных.
  const dev = g.developer || '';
  el.revealFact.textContent = dev;
  el.revealFact.parentElement.hidden = !dev;

  el.reveal.hidden = false;
  // Прошлый разбор мог оставить на кнопке причину отказа — возвращаем подпись.
  el.revive.replaceChildren(...REVIVE_LABEL.map((n) => n.cloneNode(true)));
  el.revive.disabled = false;
  el.revive.hidden = !game.canRevive;
  el.next.textContent = res.over ? 'Итоги' : 'Далее';
  el.next.focus();
  busy = false;
}

async function onNext() {
  if (el.reveal.hidden) return;
  el.reveal.hidden = true;

  if (game.isOver) {
    finish();
    return;
  }

  if (game.asked > 0 && game.asked % ADS_EVERY === 0) {
    // Под роликом можно уйти в меню и начать новую партию. Проверки на
    // «игровой экран виден» тут мало: экран-то виден, только партия уже другая,
    // и nextQuestion сдвинул бы ей вопрос, которого игрок не видел.
    const run = runId;
    busy = true;
    await withAd(() => sdk.showInterstitial({ respectCooldown: true }));
    if (run !== runId) return;
    busy = false;
  }

  nextQuestion();
}

async function withAd(showFn) {
  addPause(PAUSE.AD);
  try {
    return await showFn();
  } finally {
    // Снимаем причину в finally: иначе отказ SDK оставил бы партию на паузе
    // навсегда — ровно та «вечная пауза», за которую родительский проект
    // получил отказ по п.1.14.
    dropPause(PAUSE.AD);
  }
}

async function onRevive() {
  if (busy || !game.canRevive) return;

  // Ролик идёт секунды, и всё это время партию можно бросить и начать новую.
  // Проснувшись не в своей партии, продолжение обязано молча закончиться:
  // иначе купленная жизнь и следующий вопрос достались бы чужому забегу.
  const run = runId;
  busy = true;
  el.revive.disabled = true;
  const rewarded = await withAd(() => sdk.showRewarded());
  if (run !== runId) return;
  el.revive.disabled = false;

  if (!rewarded) {
    // Молчать нельзя: игрок решит, что кнопка сломана.
    el.revive.replaceChildren(document.createTextNode('Ролик не досмотрен — жизни не добавлены'));
    el.revive.disabled = true;
    busy = false;
    return;
  }
  if (!game.revive()) {
    busy = false;
    return;
  }

  el.reveal.hidden = true;
  renderLives();
  busy = false;
  nextQuestion();
}

async function onHint() {
  if (busy || !game.question || game.question.resolved || game.question.hintUsed) return;

  // Тот же сторож, что и в onRevive: подсказка обязана достаться тому вопросу,
  // за который игрок смотрел ролик, а не тому, что выпал после.
  const run = runId;
  const question = game.question;
  busy = true;
  el.hint.disabled = true;
  const rewarded = await withAd(() => sdk.showRewarded());
  if (run !== runId || game.question !== question) return;

  if (!rewarded) {
    // Молчать нельзя: игрок решит, что кнопка сломана.
    setStatus('Ролик не досмотрен — подсказка не сработала.');
    el.hint.disabled = false;
    busy = false;
    return;
  }

  const hidden = game.useFiftyFifty();
  for (const btn of optionButtons()) {
    if (!hidden.includes(btn.dataset.gameId)) continue;
    btn.classList.add('option--hidden');
    // Именно disabled, а не только класс: подсказка куплена просмотром рекламы,
    // и убранный вариант обязан замолчать. С одним классом он оставался
    // кликабельным и спокойно съедал жизнь — награда за рекламу не выдавалась.
    btn.disabled = true;
  }
  busy = false;
}

async function finish() {
  // Пока крутится реклама и идут запросы к площадке, игрок может уйти в меню
  // или начать новую партию — тогда эти итоги уже не его.
  const run = runId;
  questionLive = false;
  stopTimer();
  gameplayStop();
  // Кулдаун обязателен и здесь: в «Хардкоре» партия кончается за секунды, и
  // без него «Ещё раз» крутил бы рекламу чаще раза в минуту (п. 4 требований).
  await sdk.showInterstitial({ respectCooldown: true });
  if (run !== runId) return;
  // Рекорд и лидерборд — одним вызовом: отправка сравнивает результат с тем,
  // что было ДО партии, и порядок этих двух записей менять нельзя.
  const isRecord = await sdk.recordResult(game.board, game.score);
  const best = await sdk.loadBest();
  if (run !== runId) return;

  el.finalScore.textContent = String(game.score);
  el.stats.textContent = '';
  const rows = [
    ['Режим', game.isTimed ? 'На время' : game.isHardcore ? 'Хардкор' : 'Обычный'],
    ['Таблица', BOARD_LABEL[game.board]],
    ['Угадано', `${game.correctCount} из ${game.asked}`],
    ['Лучшая серия', String(game.bestStreak)],
    ['Рекорд', isRecord ? 'новый!' : String(best[game.board] || game.score)],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    el.stats.append(dt, dd);
  }

  show(el.over);

  const { entries } = await sdk.topScores(game.board, 5);
  if (run !== runId) return;
  el.board.hidden = entries.length === 0;
  fillBoardList(el.boardList, entries);
  refreshMenu();
}

async function refreshMenu() {
  const [best, board] = await Promise.all([sdk.loadBest(), sdk.topScores(BOARD.TOTAL, 5)]);

  const parts = [];
  for (const key of Object.values(BOARD)) {
    if (best[key] > 0) parts.push(`${BOARD_LABEL[key].toLowerCase()} — ${best[key]}`);
  }
  el.records.hidden = parts.length === 0;
  el.records.textContent = parts.length ? `Твой рекорд: ${parts.join(', ')}` : '';

  el.menuBoard.hidden = board.entries.length === 0;
  fillBoardList(el.menuBoardList, board.entries);
}

function fillBoardList(list, entries) {
  list.textContent = '';
  for (const entry of entries) {
    const li = document.createElement('li');
    if (entry.self) li.className = 'board__self';
    const name = document.createElement('span');
    name.className = 'board__name';
    name.textContent = `${entry.rank}. ${entry.name}`;
    const score = document.createElement('b');
    score.textContent = String(entry.score);
    li.append(name, score);
    list.append(li);
  }
}

function goHome() {
  runId++;
  questionLive = false;
  stopTimer();
  gameplayStop();
  if (game.score > 0) {
    sdk.recordResult(game.board, game.score).then(refreshMenu);
  }
  game.abandon();
  el.reveal.hidden = true;
  show(el.start);
}

/** @param {'normal'|'timed'|'hardcore'} mode */
function startGame(mode) {
  runId++;
  game.reset(mode, { kind: selKind });
  if (!game.ready) {
    setStatus('Для этого типа мало данных. Выбери другой.');
    return;
  }
  el.reveal.hidden = true;
  show(el.game);
  gameplayStart();
  nextQuestion();
}

/* ---------- Выбор типа контента ---------- */

function setKind(kind) {
  selKind = kind;
  for (const btn of el.kind.querySelectorAll('.seg__btn')) {
    btn.classList.toggle('seg__btn--on', btn.dataset.kind === kind);
  }
  // В обычном режиме тип контента выбирает таблицу — показываем какую.
  el.modeBoardNormal.textContent = `Таблица: Общий · ${KIND_LABEL[kind]}`;

  // «На время» и «Хардкор» идут в свою единственную таблицу и играются по всему
  // набору. Тип «Иконки/Скриншоты» относится только к Обычному режиму, поэтому
  // при нём эти два режима гасим — связь «тип → только Обычный» становится явной.
  const onlyAll = kind !== KIND.MIX;
  el.playTimed.disabled = onlyAll;
  el.playHard.disabled = onlyAll;
  el.modeBoardTimed.textContent = onlyAll ? 'Только при «Показывать: Всё»' : 'Таблица: На время';
  el.modeBoardHard.textContent = onlyAll ? 'Только при «Показывать: Всё»' : 'Таблица: Хардкор';
}

/* ---------- Лидерборды из главного меню ---------- */

/** Вкладки окна лидербордов: элемент → ключ таблицы. */
function boardTabs() {
  return [
    [el.tabTotal, BOARD.TOTAL],
    [el.tabIcons, BOARD.ICONS],
    [el.tabShots, BOARD.SHOTS],
    [el.tabTimed, BOARD.TIMED],
    [el.tabHardcore, BOARD.HARDCORE],
  ];
}

/** @param {'total'|'icons'|'shots'|'timed'|'hardcore'} board */
async function openBoards(board) {
  boardKey = board;
  el.boards.hidden = false;
  for (const [tab, b] of boardTabs()) {
    tab.classList.toggle('tab--on', board === b);
    tab.setAttribute('aria-selected', String(board === b));
  }

  el.boardsList.textContent = '';
  el.boardsNote.textContent = 'Загружаю…';

  const { entries, available, error } = await sdk.topScores(board, 10);
  if (boardKey !== board) return;

  fillBoardList(el.boardsList, entries);
  if (!available) {
    // Техническую причину пишем в консоль: игроку английский текст ошибки SDK
    // показывать нельзя — все надписи в игре русские (п. 1.5).
    if (error) console.warn('[boards] таблица недоступна:', error);
    el.boardsNote.textContent = sdk.available
      ? 'Таблица сейчас недоступна. Попробуй зайти позже.'
      : 'Лидерборды доступны только внутри Яндекс Игр. Локально таблица пустая.';
  } else if (!entries.length) {
    el.boardsNote.textContent = 'Пока никто не играл в этой таблице. Будь первым!';
  } else {
    el.boardsNote.textContent = 'Чтобы попасть в таблицу, войди в аккаунт Яндекса.';
  }
}

/* ---------- Запуск ---------- */

function bootError(title, hint) {
  el.boot.classList.add('boot--error');
  el.bootText.textContent = title;
  if (hint) {
    const p = document.createElement('p');
    p.className = 'boot__hint';
    p.textContent = hint;
    el.boot.append(p);
  }
}

async function boot() {
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  await sdk.init();
  document.documentElement.lang = sdk.lang;

  let games;
  let items = [];
  try {
    ({ games } = await loadJSON('data/games.json'));
    // Иконки и скриншоты — независимые наборы; каждого может не быть.
    const [icons, shots] = await Promise.all([
      loadJSON('data/icons.json').catch(() => ({ icons: [] })),
      loadJSON('data/shots.json').catch(() => ({ shots: [] })),
    ]);
    items = [...(icons.icons ?? []), ...(shots.shots ?? [])];
  } catch (e) {
    bootError('Не удалось загрузить данные игры', 'Проверь соединение и обнови страницу.');
    console.error(e);
    return;
  }

  game = new Game(items, games);
  if (!game.ready) {
    bootError(
      'Не удалось загрузить данные игры',
      'Обнови страницу — если не помогло, попробуй зайти позже.',
    );
    return;
  }

  setIcon(el.scoreIcon, 'star', { size: 17 });
  setIcon(el.hintIcon, 'bulb', { size: 17 });
  setIcon(el.homeIcon, 'home', { size: 18 });
  setIcon(el.timerIcon, 'clock', { size: 19 });

  // Тип «Иконки» имеет смысл только если иконки есть.
  const hasIcons = items.some((it) => it.kind === KIND.ICON);
  const hasShots = items.some((it) => it.kind === KIND.SHOT);
  for (const btn of el.kind.querySelectorAll('.seg__btn')) {
    if (btn.dataset.kind === KIND.ICON) btn.hidden = !hasIcons;
    if (btn.dataset.kind === KIND.SHOT) btn.hidden = !hasShots;
  }
  selKind = hasIcons && hasShots ? KIND.MIX : hasIcons ? KIND.ICON : KIND.SHOT;
  setKind(selKind);

  el.kind.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg__btn');
    if (btn) setKind(btn.dataset.kind);
  });

  music.init(renderSound);
  el.sound.addEventListener('click', () => music.toggle());
  el.soundMenu.addEventListener('click', () => music.toggle());

  el.home.addEventListener('click', goHome);
  el.play.addEventListener('click', () => startGame(MODE.NORMAL));
  el.playTimed.addEventListener('click', () => startGame(MODE.TIMED));
  el.playHard.addEventListener('click', () => startGame(MODE.HARDCORE));
  el.again.addEventListener('click', () => startGame(game.mode));
  el.hint.addEventListener('click', onHint);
  el.next.addEventListener('click', onNext);
  el.revive.addEventListener('click', onRevive);

  el.boardsOpen.addEventListener('click', () => openBoards(BOARD.TOTAL));
  el.boardsClose.addEventListener('click', () => { el.boards.hidden = true; });
  for (const [tab, board] of boardTabs()) {
    tab.addEventListener('click', () => openBoards(board));
  }
  window.addEventListener('keydown', (e) => {
    if (el.reveal.hidden || (e.key !== 'Enter' && e.key !== ' ')) return;
    // Если фокус стоит на кнопке разбора, пусть браузер нажмёт именно её: иначе
    // Enter на «Продолжить за рекламу» уводил в итоги вместо возрождения.
    if (e.target instanceof Element && e.target.closest('#reveal button')) return;
    e.preventDefault();
    onNext();
  });
  el.creditsOpen.addEventListener('click', () => { el.credits.hidden = false; });
  el.creditsClose.addEventListener('click', () => { el.credits.hidden = true; });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) addPause(PAUSE.HIDDEN);
    else dropPause(PAUSE.HIDDEN);
  });
  // Событие возврата на вкладку приходит не всегда (bfcache на мобильных).
  // Без сторожа партия оставалась бы на паузе при живом экране, а площадка
  // считала бы, что геймплея нет. Сверяем реальное состояние вкладки.
  window.addEventListener('focus', () => dropPause(PAUSE.HIDDEN));
  setInterval(() => {
    if (!document.hidden) dropPause(PAUSE.HIDDEN);
  }, 1000);
  // Паузы со стороны площадки (game_api_pause/resume) — отдельная причина.
  sdk.onPause(
    () => {
      addPause(PAUSE.PLATFORM);
      clearTimeout(platformPauseTimer);
      // Своей развязки у этой причины нет — только ответное событие площадки.
      // Не пришло, а вкладка при этом на виду — снимаем сами (п. 1.14).
      platformPauseTimer = setTimeout(() => {
        if (!document.hidden) dropPause(PAUSE.PLATFORM);
      }, PLATFORM_PAUSE_TIMEOUT_MS);
    },
    () => {
      clearTimeout(platformPauseTimer);
      dropPause(PAUSE.PLATFORM);
    },
  );

  // Перерисовка картинки при любом изменении размера рамки. ResizeObserver
  // ловит всё разом: поворот экрана, вход и выход из полноэкранного режима,
  // изменение размеров iframe самой площадкой. Одного window.resize мало — на
  // мобиле при повороте он приходит не всегда и не вовремя, и тогда канвас
  // остаётся с прежним растром: картинка деформируется или обрезается
  // (п. 1.6.1.3 и 1.10.1 — ровно та беда, за которую нас уже завернули).
  // orientationchange и fullscreenchange оставлены подстраховкой для браузеров
  // без ResizeObserver.
  let resizeTimer;
  const redraw = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (currentImg && !el.game.hidden) {
        drawItem(el.canvas, currentImg, game.question?.item.blur ?? []);
      }
    }, 150);
  };
  window.addEventListener('resize', redraw);
  window.addEventListener('orientationchange', redraw);
  document.addEventListener('fullscreenchange', redraw);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(redraw).observe(el.canvas.parentElement);
  }

  el.boot.hidden = true;
  show(el.start);
  sdk.ready();
  refreshMenu();
}

boot();
