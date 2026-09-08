/**
 * Фоновая музыка.
 *
 * Web Audio, а не <audio loop>: у тега на стыке цикла слышен щелчок (в MP3
 * остаются служебные тишины кодировщика), а здесь цикл задаётся точками
 * loopStart/loopEnd по декодированному буферу — стык не слышен. Заодно один
 * узел громкости на всё: плавные затухания вместо резкого обрыва.
 *
 * Права: трек CC0, лицензия и источник записаны в теги самого файла
 * (`copyright` и `comment`), а не только в документацию — чтобы модерации было
 * видно прямо из файла (п. 3.5).
 *
 * Что обязана уметь музыка по требованиям площадки:
 *   п. 1.3 — молчать, когда вкладка скрыта;
 *   п. 4.7 — молчать во время полноэкранной рекламы;
 *   и то и другое приходит сюда одной парой pause/resume из общего счётчика
 *   причин в main.js: второго списка причин здесь нет намеренно.
 *
 * Выбор игрока (выключил звук) хранится отдельно от паузы и переживает её.
 * Иначе повторный заход «запомнил» бы уже выставленную тишину и оставил игру
 * немой навсегда — на этом обжёгся соседний проект.
 */

const SRC = 'audio/theme.mp3';
/** Ключ в localStorage: выключил ли игрок звук. */
const KEY = 'muted';
/** Громкость фона. Музыка не должна перебивать сама игру. */
const VOLUME = 0.32;
/** Длительность затухания, с. */
const FADE = 0.35;
/**
 * Обрезка на стыке цикла, с. Съедает служебные тишины кодировщика по краям:
 * без неё в петле слышен щелчок. На фоновом эмбиенте 30 мс не различить.
 */
const EDGE = 0.03;

/** @type {AudioContext|null} */
let ctx = null;
/** @type {GainNode|null} */
let gain = null;
/** @type {AudioBufferSourceNode|null} */
let source = null;
/** @type {Promise<AudioBuffer>|null} */
let bufferP = null;

/** Выбор игрока: выключен ли звук. Живёт отдельно от паузы. */
let muted = readMuted();
/** Пауза от игры: скрытая вкладка, реклама, пауза площадки. */
let paused = false;
/** Игрок уже сделал жест, после которого браузер разрешает звук. */
let started = false;
/** Кого позвать, когда состояние изменилось (перерисовать кнопки). */
let onChange = () => {};

function readMuted() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Приватное окно или запрет на хранилище — просто играем со звуком.
    return false;
  }
}

function saveMuted() {
  try {
    localStorage.setItem(KEY, muted ? '1' : '0');
  } catch {
    /* не смертельно: выбор не переживёт перезагрузку, звук работать будет */
  }
}

/** Должен ли звук идти прямо сейчас. */
function audible() {
  return started && !muted && !paused;
}

/** Скачиваем и декодируем один раз; повторные вызовы отдают тот же промис. */
function load() {
  bufferP ??= fetch(SRC)
    .then((res) => {
      if (!res.ok) throw new Error(`${SRC}: ${res.status}`);
      return res.arrayBuffer();
    })
    .then((data) => ctx.decodeAudioData(data))
    .catch((e) => {
      // Музыка — украшение: не загрузилась, играем дальше молча.
      console.warn('[audio] трек не загружен:', e?.message ?? e);
      bufferP = null;
      throw e;
    });
  return bufferP;
}

/** Плавно ведёт громкость к цели. */
function ramp(to) {
  if (!gain || !ctx) return;
  const now = ctx.currentTime;
  // setValueAtTime от текущего значения: иначе новая линия пойдёт от той,
  // что не успела доиграть, и получится скачок.
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(to, now + FADE);
}

/** Приводит звук в соответствие с состоянием. */
async function apply() {
  onChange();
  if (!ctx) return;

  if (!audible()) {
    ramp(0);
    // Контекст усыпляем после затухания: иначе обрыв слышен как щелчок.
    // Требование п. 4.7 — именно замолчать, а не убавить.
    setTimeout(() => {
      if (!audible() && ctx?.state === 'running') ctx.suspend().catch(() => {});
    }, FADE * 1000 + 60);
    return;
  }

  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch (e) {
    console.warn('[audio] resume:', e?.message ?? e);
    return;
  }

  if (!source) {
    let buffer;
    try {
      buffer = await load();
    } catch {
      return;
    }
    // Пока декодировали, игрок мог выключить звук или начаться реклама.
    if (!audible()) return apply();

    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = EDGE;
    source.loopEnd = Math.max(EDGE * 2, buffer.duration - EDGE);
    source.connect(gain);
    source.start(0, EDGE);
  }
  ramp(VOLUME);
}

export const music = {
  get muted() {
    return muted;
  },

  /**
   * Готовит звук. Сам ничего не играет: браузеры не дают запустить звук до
   * жеста игрока, поэтому старт вешается на первый клик или нажатие клавиши.
   * @param {() => void} render перерисовать кнопки звука
   */
  init(render) {
    onChange = render ?? (() => {});
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) {
      console.info('[audio] Web Audio недоступен — играем без музыки');
      return;
    }
    ctx = new Ctx();
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);

    const kick = () => {
      started = true;
      apply();
    };
    // once: первый же жест снимает запрет автозапуска, дальше слушатель не нужен.
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      window.addEventListener(ev, kick, { once: true, passive: true });
    }
    onChange();
  },

  /** Переключает звук по кнопке. Выбор игрока запоминается. */
  toggle() {
    muted = !muted;
    saveMuted();
    // Клик по самой кнопке — тоже жест: если музыка ещё не начиналась,
    // включение звука обязано её запустить, а не ждать следующего клика.
    started = true;
    apply();
    return muted;
  },

  /** Игра встала: вкладка скрыта, идёт реклама, площадка попросила паузу. */
  pause() {
    if (paused) return;
    paused = true;
    apply();
  },

  /** Игра продолжилась. Выбор игрока при этом не теряется. */
  resume() {
    if (!paused) return;
    paused = false;
    apply();
  },

  /** Для проверок: слышно ли сейчас звук на самом деле. */
  get state() {
    return { muted, paused, started, ctx: ctx?.state ?? 'нет', gain: gain?.gain.value ?? 0 };
  },
};
