/**
 * Рисует картинку (иконку-ярлык или скриншот) на canvas и замыливает
 * размеченные области — название игры, если оно есть прямо на картинке.
 *
 * Раньше здесь была сплошная заливка — чёрный прямоугольник поверх названия.
 * Прочесть его нельзя по определению, но и кадр он портил: игрок видел не
 * скриншот, а скриншот с дырой. Блюр оставляет кадр целым и читается как часть
 * картинки, а не как заплатка.
 */

/**
 * До какой высоты в пикселях ужимаем область перед тем, как растянуть обратно.
 * Текст занимает почти всю высоту размеченной области, так что после сжатия до
 * четырёх пикселей от букв не остаётся ничего, что можно вычитать обратно
 * подкруткой контраста.
 */
const BLUR_TARGET_PX = 4;

/** Загружает изображение. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`не загрузилось: ${src}`));
    img.src = src;
  });
}

/**
 * Вписывает изображение в canvas целиком (object-fit: contain).
 * Именно contain, а не cover: обрезка краёв могла бы отрезать часть иконки
 * или ключевую деталь скриншота, по которой игрок и угадывает.
 * @returns {{dx:number, dy:number, dw:number, dh:number}} куда легло изображение
 */
function containFit(img, cw, ch) {
  const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  return { dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

/**
 * Два вспомогательных холста для лесенки уменьшений. Переиспользуются между
 * вызовами: на каждый кадр их бывает несколько, а создание холста не бесплатно.
 * Рисуем по очереди из одного в другой, а не холста в самого себя: так проще
 * рассуждать о перекрытии областей чтения и записи.
 */
let scratchA = null;
let scratchB = null;

function scratch(which, w, h) {
  let c = which === 'a' ? scratchA : scratchB;
  if (!c) {
    c = document.createElement('canvas');
    if (which === 'a') scratchA = c;
    else scratchB = c;
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/** Включает сглаживание — от него зависит, будет это блюр или мозаика. */
function smooth(ctx) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * Замыливает прямоугольник кадра.
 *
 * Уменьшаем кусок до нескольких пикселей и растягиваем обратно со
 * сглаживанием. Так это работает в любом браузере, в отличие от
 * `ctx.filter = 'blur()'`, которого Safari до 16.4 не знает вовсе — а на старом
 * Safari нас уже ловили (п. 1.6.1.8), полагаться на него нельзя.
 *
 * И вниз, и вверх идём вдвое за проход. Один резкий скачок `drawImage` даёт не
 * размытие, а алиасинг: часть штрихов букв выживает, и мелкий текст местами
 * вычитывается обратно. Лесенка половинных шагов — это, по сути, пирамида
 * Гаусса: получается ровное мыло без остатков контуров.
 *
 * @param {CanvasRenderingContext2D} ctx куда рисуем
 * @param {HTMLCanvasElement} source откуда берём пиксели (тот же холст)
 */
function blurArea(ctx, source, x, y, w, h) {
  if (w < 2 || h < 2) return;

  let cw = Math.max(1, Math.round(w));
  let ch = Math.max(1, Math.round(h));

  // Вырезаем область в рабочий холст как есть.
  let from = scratch('a', cw, ch);
  smooth(from.getContext('2d')).drawImage(source, x, y, w, h, 0, 0, cw, ch);

  // Вниз до BLUR_TARGET_PX по высоте.
  let flip = false;
  while (ch > BLUR_TARGET_PX) {
    const nw = Math.max(1, Math.round(cw / 2));
    const nh = Math.max(1, Math.round(ch / 2));
    const to = scratch(flip ? 'a' : 'b', nw, nh);
    smooth(to.getContext('2d')).drawImage(from, 0, 0, cw, ch, 0, 0, nw, nh);
    from = to;
    cw = nw;
    ch = nh;
    flip = !flip;
    // Ширина могла упереться в единицу раньше высоты — дальше уменьшать нечего.
    if (cw <= 1 && ch <= 1) break;
  }

  // Обратно вверх такими же половинными шагами, пока не догоним размер области.
  while (ch * 2 <= h) {
    const nw = Math.max(1, Math.round(cw * 2));
    const nh = Math.max(1, Math.round(ch * 2));
    const to = scratch(flip ? 'a' : 'b', nw, nh);
    smooth(to.getContext('2d')).drawImage(from, 0, 0, cw, ch, 0, 0, nw, nh);
    from = to;
    cw = nw;
    ch = nh;
    flip = !flip;
  }

  ctx.save();
  // Клип обязателен: сглаживание при растягивании тянет цвет за края
  // прямоугольника, и без него блюр вылезал бы на соседние пиксели кадра.
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  smooth(ctx).drawImage(from, 0, 0, cw, ch, x, y, w, h);
  ctx.restore();
}

/**
 * Рисует картинку с замыленными областями.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement} img
 * @param {Array<{x:number,y:number,w:number,h:number}>} regions доли 0..1
 */
export function drawItem(canvas, img, regions = []) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 640;
  const cssH = canvas.clientHeight || 420;

  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { dx, dy, dw, dh } = containFit(img, canvas.width, canvas.height);
  ctx.drawImage(img, dx, dy, dw, dh);

  for (const r of regions) {
    const x = dx + r.x * dw;
    const y = dy + r.y * dh;
    const w = r.w * dw;
    const h = r.h * dh;

    const cx = Math.max(0, Math.floor(x));
    const cy = Math.max(0, Math.floor(y));
    const cw = Math.min(canvas.width, Math.ceil(x + w)) - cx;
    const chh = Math.min(canvas.height, Math.ceil(y + h)) - cy;
    if (cw > 0 && chh > 0) blurArea(ctx, canvas, cx, cy, cw, chh);
  }
}
