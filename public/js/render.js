/**
 * Рисует картинку (иконку-ярлык или скриншот) на canvas и закрашивает
 * размеченные области — название игры, если оно есть прямо на картинке.
 *
 * Закрашиваем сплошной заливкой: она не зависит от поддержки ctx.filter в
 * мобильных браузерах и её нельзя «отменить» подкруткой контраста.
 */

/** Цвет заливки поверх названия. */
const COVER_FILL = '#0b0d12';

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
 * Заливает прямоугольник сплошным цветом.
 * Сплошная заливка, а не пикселизация: из пикселей крупный текст иногда всё
 * ещё читался, а закрашенный квадрат не оставляет вариантов. Заодно он прощает
 * неточную рамку — чуть больший квадрат просто выглядит аккуратно.
 */
function coverArea(ctx, x, y, w, h) {
  if (w < 2 || h < 2) return;
  ctx.save();
  ctx.fillStyle = COVER_FILL;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Рисует картинку с закрашенными областями.
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
    if (cw > 0 && chh > 0) coverArea(ctx, cx, cy, cw, chh);
  }
}
