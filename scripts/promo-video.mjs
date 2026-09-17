/**
 * Промо-ролик для карточки Яндекс Игр: 60 fps, H.264/MP4, без звука. Снимается
 * в двух форматах — вертикальном 1080×1920 (9:16) и горизонтальном 1920×1080
 * (16:9); какой снимать, задаёт аргумент запуска (см. FORMATS ниже). В кадре
 * только геймплей — ни меню, ни браузера, ни посторонних элементов
 * (требование к видеоматериалам: реальный геймплей не меньше 70% длительности,
 * никаких элементов ОС и площадки).
 *
 * Как снимается. Игра открывается в headless-Chrome с вьюпортом, который на
 * своём deviceScaleFactor даёт ровно нужный размер в физических пикселях:
 * 432×768 при 2.5 для вертикали (мобильный макет) и 1280×720 при 1.5 для
 * горизонтали (десктопный) — те же пары, что у промо-кадров. Кадры снимаются через CDP
 * `Page.startScreencast`: Chrome отдаёт кадр на каждую отрисовку, в движении
 * это чаще 60 раз в секунду, а на статичном экране кадров нет вообще. Поэтому
 * ролик не склеивается из кадров «как есть», а пересобирается по времени: на
 * каждый слот 1/60 секунды берётся последний снятый к этому моменту кадр.
 * Получается честный CFR 60 fps без рывков и без дублей там, где что-то
 * двигается.
 *
 * Почему не виртуальное время (`Emulation.setVirtualTimePolicy`): бюджет не
 * истекает из-за висящих запросов, а `page.screenshot()` под паузой занимает
 * секунды — за разумное время 1200 кадров так не снять.
 *
 * Ролик режется на три сцены — иконки, скриншоты (с подсказкой 50/50) и режим
 * «на время» с таймером. Между сценами запись останавливается, поэтому переход
 * через меню в кадр не попадает: получается жёсткая склейка с вопроса на
 * вопрос.
 *
 * Нужен запущенный дев-сервер (npm run serve) и ffmpeg (см. ffmpegPath в lib.mjs).
 * Запуск: npm run promo-video       — вертикальный 1080×1920
 *         npm run promo-video-wide  — горизонтальный 1920×1080
 */
import { join, dirname } from 'node:path';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { ROOT, sleep, chromePath, ffmpegPath, h264Args, h264Name, promoBundleBody, respondPromoBundle } from './lib.mjs';

const CHROME = chromePath();
const PAGE_URL = `http://localhost:${process.env.PORT || 8080}/`;

const FPS = 60;
/** Верхняя граница длительности: карточке хватает 15–20 секунд. */
const MAX_SECONDS = 20;

/**
 * Форматы ролика. `view` — вьюпорт в CSS-пикселях: на своём `dsf` он даёт ровно
 * `width`×`height` физических пикселей, поэтому кадр скринкаста не приходится
 * масштабировать.
 *
 * Вертикаль снимается мобильным макетом (как промо-кадры `mobile-*`),
 * горизонталь — десктопным (как `pc-*`). Высота десктопного вьюпорта именно
 * 720, а не 540: на 540 включается медиазапрос «низкий ландшафт» — раскладка
 * для телефона лёжа, а не то, что видит игрок за компьютером.
 */
const FORMATS = {
  vertical: {
    file: 'video-vertical.mp4',
    width: 1080,
    height: 1920,
    view: { width: 432, height: 768, dsf: 2.5 },
    mobile: true,
  },
  horizontal: {
    file: 'video-horizontal.mp4',
    width: 1920,
    height: 1080,
    view: { width: 1280, height: 720, dsf: 1.5 },
    mobile: false,
  },
};

const FORMAT_NAME = process.argv[2] ?? 'vertical';
const FMT = FORMATS[FORMAT_NAME];
if (!FMT) {
  console.error(`Неизвестный формат «${FORMAT_NAME}». Есть: ${Object.keys(FORMATS).join(', ')}`);
  process.exit(1);
}

const WIDTH = FMT.width;
const HEIGHT = FMT.height;
const VIEW = FMT.view;
const OUT = join(ROOT, 'promo', FMT.file);
/** Кадры каждого формата в своём каталоге — чтобы два прогона не затёрли друг друга. */
const WORK = join(ROOT, 'scripts', '.cache', `video-${FORMAT_NAME}`);

/**
 * Тайминги сцены в миллисекундах. Держим их здесь одним блоком: длительность
 * ролика правится только этими числами.
 */
const PACE = {
  look: 1400,      // смотрим на картинку и читаем варианты
  lookTimed: 1300, // то же в режиме «на время» — там темп быстрее
  read: 1500,      // читаем разбор с правильным ответом
  tail: 1300,      // хвост последнего разбора в сцене
  beforeHint: 800, // пауза перед нажатием 50/50
  afterHint: 900,  // пауза после того, как два неверных варианта убрались
  intro: 80,       // задержка перед перезапуском анимации появления карточки
  hold: 120,       // сколько держим последний кадр сцены
};

/** Сцены ролика. Каждая пишется отдельно и склеивается встык. */
const SCENES = [
  { name: 'icons', kind: 'icon', mode: '#btn-play', questions: 2, hintOn: -1 },
  { name: 'shots', kind: 'shot', mode: '#btn-play', questions: 2, hintOn: 0 },
  { name: 'timed', kind: null, mode: '#btn-play-timed', questions: 2, hintOn: -1 },
];

/* ---------- Подмена скриптов страницы ---------- */

/**
 * Хук в `js/main.js`: отдаёт правильный ответ текущего вопроса и умеет
 * перезапустить анимацию появления карточки. Дописывается к файлу на лету, в
 * `public/` ничего не меняется — в игре, которая уедет на площадку, никаких
 * отладочных ручек нет.
 */
const PROMO_HOOK = `
globalThis.__promo = {
  correctId: () => game?.question?.correctId ?? null,
  kind: () => game?.question?.item?.kind ?? null,
  replayIntro: () => playPhotoIntro(),
};
`;

/** SDK на площадке отдаёт Яндекс; при записи он не нужен и не должен мешать. */
const SDK_STUB = '/* промо-запись: игра идёт в локальном режиме без YaGames */';

/**
 * Подменяет два ответа сервера: `js/main.js` (дописывает хук) и `/sdk.js`
 * (пустышка). Пустышка важна не только для скорости: с живым SDK на кадр
 * может выехать рекламный блок, а рекламы в промо-ролике быть не должно.
 */
async function interceptScripts(page) {
  const mainJs = await readFile(join(ROOT, 'public', 'js', 'main.js'), 'utf8');
  // Данные — урезанный набор PROMO_GAMES: в ролик не должен попасть случайный
  // кадр с чужой плашкой или логотипом магазина.
  const bundle = await promoBundleBody();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (respondPromoBundle(req, bundle)) return;
    const path = new URL(req.url()).pathname;
    if (path === '/sdk.js') {
      return req.respond({ status: 200, contentType: 'text/javascript; charset=utf-8', body: SDK_STUB });
    }
    if (path === '/js/main.js') {
      return req.respond({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: mainJs + PROMO_HOOK,
      });
    }
    return req.continue();
  });
}

/* ---------- Запись кадров ---------- */

/**
 * Пишет кадры скринкаста в каталог сцены. Кадр подтверждается сразу
 * (`screencastFrameAck`), иначе Chrome перестаёт присылать следующие, а запись
 * на диск идёт уже после подтверждения и не тормозит поток.
 */
class Recorder {
  constructor(page, dir) {
    this.page = page;
    this.dir = dir;
    this.frames = []; // { file, t } — t в миллисекундах от начала сцены
    this.writes = [];
    this.n = 0;
    this.t0 = null;
  }

  async start() {
    await mkdir(this.dir, { recursive: true });
    this.cdp = await this.page.createCDPSession();
    this.cdp.on('Page.screencastFrame', (e) => {
      this.cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
      const t = (e.metadata?.timestamp ?? Date.now() / 1000) * 1000;
      if (this.t0 === null) this.t0 = t;
      const file = `${String(this.n++).padStart(6, '0')}.jpg`;
      this.frames.push({ file, t: t - this.t0 });
      this.writes.push(writeFile(join(this.dir, file), Buffer.from(e.data, 'base64')));
    });
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 100, // ролик потом жмётся x264; лишние JPEG-артефакты не нужны
      maxWidth: WIDTH + 40,
      maxHeight: HEIGHT + 40,
      everyNthFrame: 1,
    });
  }

  async stop() {
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await Promise.all(this.writes);
    await this.cdp.detach().catch(() => {});
    return this.frames;
  }
}

/* ---------- Управление игрой ---------- */

/** Ждёт готовый вопрос: варианты кликабельны, картинка нарисована. */
async function waitQuestion(page) {
  await page.waitForSelector('#screen-game:not([hidden])', { timeout: 15000 });
  await page.waitForSelector('.option:not([disabled])', { timeout: 15000 });
  await page.waitForFunction(() => {
    const c = document.getElementById('canvas');
    return c && c.width > 0 && c.height > 0;
  }, { timeout: 15000 });
}

/**
 * Кружок касания под пальцем игрока. Рисуется внутри страницы и снимается
 * вместе с кадром: без него в ролике варианты переключаются сами собой и
 * непонятно, что игрок вообще что-то выбирает.
 */
async function tapMark(page, x, y) {
  await page.evaluate((cx, cy) => {
    const dot = document.createElement('div');
    dot.style.cssText = [
      'position:fixed', `left:${cx}px`, `top:${cy}px`,
      'width:56px', 'height:56px', 'margin:-28px 0 0 -28px',
      'border-radius:50%', 'border:2px solid rgba(255,255,255,.9)',
      'background:rgba(255,255,255,.18)', 'pointer-events:none', 'z-index:99',
    ].join(';');
    document.body.append(dot);
    dot.animate(
      [
        { transform: 'scale(.35)', opacity: 0.9 },
        { transform: 'scale(1.25)', opacity: 0 },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' },
    ).onfinish = () => dot.remove();
  }, x, y);
}

/**
 * Куда увести курсор после нажатия. У `.option`, `.chip` и `.mode` есть
 * `:hover` без `@media (hover: hover)`, поэтому брошенный на кнопке курсор
 * подсвечивает её рамкой — на телефоне такого не бывает, а в кадр попадало бы.
 * Точка — середина картинки: там правил наведения нет. Меряем её по месту, а не
 * держим константой: в горизонтальном макете картинка стоит совсем не там, где
 * в вертикальном, и прежняя константа села бы ровно на кнопку.
 */
let park = { x: VIEW.width / 2, y: VIEW.height / 2 };

/** Пересчитывает точку парковки под текущий макет. */
async function measurePark(page) {
  const point = await page
    .$eval('.photo', (node) => {
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })
    .catch(() => null);
  if (point) park = point;
}

/** Нажимает элемент с касанием в кадре. */
async function tap(page, selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`нет элемента: ${selector}`);
  const box = await el.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await tapMark(page, x, y);
  await page.mouse.click(x, y);
  await page.mouse.move(park.x, park.y);
}

/** Нажимает правильный вариант — его id берём из хука, промахов в ролике нет. */
async function tapCorrect(page) {
  const id = await page.evaluate(() => globalThis.__promo.correctId());
  if (!id) throw new Error('не удалось узнать правильный ответ');
  await tap(page, `.option[data-game-id="${id}"]`);
}

/** Открывает игру и запускает партию нужного вида. */
async function startGame(page, scene) {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#screen-start:not([hidden])', { timeout: 20000 });
  if (scene.kind) await page.click(`#kind [data-kind="${scene.kind}"]`);
  await page.click(scene.mode);
  await waitQuestion(page);
  await measurePark(page);
  await page.mouse.move(park.x, park.y);
}

/**
 * Снимает одну сцену: партия уже запущена, дальше идут вопросы с паузами из
 * PACE. Возвращает список кадров сцены.
 */
async function recordScene(browser, scene, index) {
  const page = await browser.newPage();
  await page.setViewport({
    width: VIEW.width,
    height: VIEW.height,
    deviceScaleFactor: VIEW.dsf,
    isMobile: FMT.mobile,
    hasTouch: FMT.mobile,
  });
  await interceptScripts(page);
  await startGame(page, scene);

  const rec = new Recorder(page, join(WORK, `scene-${index}-${scene.name}`));
  await rec.start();
  // Первый вопрос уже нарисован — переигрываем появление карточки, чтобы сцена
  // открывалась движением, а не статичным кадром.
  await sleep(PACE.intro);
  await page.evaluate(() => globalThis.__promo.replayIntro());

  const timed = scene.mode === '#btn-play-timed';
  for (let q = 0; q < scene.questions; q++) {
    const last = q === scene.questions - 1;

    if (q === scene.hintOn) {
      await sleep(PACE.beforeHint);
      await tap(page, '#btn-hint');
      await page.waitForSelector('.option--hidden', { timeout: 5000 }).catch(() => {});
      await sleep(PACE.afterHint);
    } else {
      await sleep(timed ? PACE.lookTimed : PACE.look);
    }

    await tapCorrect(page);
    await page.waitForSelector('#reveal:not([hidden])', { timeout: 8000 });
    await sleep(last ? PACE.tail : PACE.read);

    if (!last) {
      await tap(page, '#btn-next');
      await waitQuestion(page);
    }
  }
  await sleep(PACE.hold);

  const frames = await rec.stop();
  await page.close();
  console.log(`  сцена «${scene.name}»: ${frames.length} кадров, ${(frames.at(-1).t / 1000).toFixed(2)} с`);
  return { dir: join(WORK, `scene-${index}-${scene.name}`), frames };
}

/* ---------- Сборка видео ---------- */

/** Размеры JPEG из заголовка SOF — проверяем, что снялось именно 1080×1920. */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * Раскладывает снятые кадры по слотам 1/60 секунды: на каждый слот берётся
 * последний кадр, снятый к этому моменту. Так реальный тайминг геймплея
 * сохраняется, а на выходе получается ровный CFR.
 */
function resample(scenes) {
  const slots = [];
  for (const scene of scenes) {
    const { frames, dir } = scene;
    if (!frames.length) continue;
    const dur = frames.at(-1).t + PACE.hold;
    const count = Math.max(1, Math.round((dur / 1000) * FPS));
    let cur = 0;
    for (let i = 0; i < count; i++) {
      const t = (i * 1000) / FPS;
      while (cur + 1 < frames.length && frames[cur + 1].t <= t) cur++;
      slots.push(join(dir, frames[cur].file));
    }
  }
  return slots.slice(0, MAX_SECONDS * FPS);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-2000)))));
  });
}

/** Кодирует список кадров в MP4: H.264 high, yuv420p, 60 fps, без звука. */
async function encode(slots) {
  const listPath = join(WORK, 'frames.txt');
  const body = slots
    .map((f) => `file '${f.replace(/\\/g, '/')}'\nduration ${(1 / FPS).toFixed(6)}`)
    .join('\n');
  // Последний файл дублируется без duration — иначе concat отбрасывает его кадр.
  await writeFile(listPath, `ffconcat version 1.0\n${body}\nfile '${slots.at(-1).replace(/\\/g, '/')}'\n`);

  await mkdir(dirname(OUT), { recursive: true });
  await run(ffmpegPath(), [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    // JPEG-кадры идут в полном диапазоне яркости; переводим в телевизионный и
    // помечаем bt709 — иначе плеер, который не смотрит на yuvj420p, покажет
    // ролик светлее, чем игра выглядит на самом деле.
    '-vf', `scale=${WIDTH}:${HEIGHT}:flags=lanczos:in_range=full:out_range=limited,setsar=1,format=yuv420p`,
    '-r', String(FPS), '-fps_mode', 'cfr',
    // Кодировщик выбирается по тому, что есть в найденной сборке ffmpeg:
    // libx264 есть не везде (см. h264Args в lib.mjs).
    ...h264Args(),
    '-color_range', 'tv', '-colorspace', 'bt709',
    '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-movflags', '+faststart', '-an',
    OUT,
  ]);
}

/* ---------- Запуск ---------- */

console.log(`Формат: ${FORMAT_NAME} — ${WIDTH}×${HEIGHT}, кодировщик ${h264Name()}`);
await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--hide-scrollbars',
    '--mute-audio',
    // Снимают потолок в 60 кадров у композитора: чем чаще Chrome рисует, тем
    // точнее ложится пересборка под 60 fps.
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    '--disable-features=CalculateNativeWinOcclusion',
    '--force-color-profile=srgb',
    `--force-device-scale-factor=${VIEW.dsf}`,
  ],
});

const scenes = [];
for (const [i, scene] of SCENES.entries()) {
  scenes.push(await recordScene(browser, scene, i + 1));
}
await browser.close();

const first = scenes.find((s) => s.frames.length);
if (!first) throw new Error('не снялось ни одного кадра');
const size = jpegSize(await readFile(join(first.dir, first.frames[0].file)));
if (!size || size.width !== WIDTH || size.height !== HEIGHT) {
  throw new Error(`кадр ${size?.width}×${size?.height}, а нужен ${WIDTH}×${HEIGHT}`);
}

const slots = resample(scenes);
console.log(`Кодирую ${slots.length} кадров → ${(slots.length / FPS).toFixed(2)} с`);
await encode(slots);
await rm(WORK, { recursive: true, force: true });
console.log(`Готово → ${OUT}`);
