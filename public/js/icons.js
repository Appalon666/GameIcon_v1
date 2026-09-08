/**
 * Иконки интерфейса. Рисуются как inline-SVG прямо в JS: не нужны файлы,
 * иконка наследует цвет текста через currentColor и не мылится на retina.
 *
 * Все контуры нарисованы в сетке 24×24 в одном стиле: обводка, скруглённые
 * концы, без заливки — кроме звезды, которая по смыслу залитая.
 */

const NS = 'http://www.w3.org/2000/svg';

/**
 * @typedef {object} IconDef
 * @property {string[]} paths контуры
 * @property {boolean} [filled] залитая иконка вместо обводки
 * @property {Array<[number,number,number]>} [circles] круги [cx, cy, r]
 */

/** @type {Record<string, IconDef>} */
const ICONS = {
  /** Лампочка — подсказка 50/50. */
  bulb: {
    paths: [
      'M12 3a6 6 0 0 1 3.5 10.9c-.6.4-1 1.1-1 1.9v.2h-5v-.2c0-.8-.4-1.5-1-1.9A6 6 0 0 1 12 3z',
      'M9.5 19h5',
      'M10.5 21.5h3',
    ],
  },

  /** Часы — таймер режима «на время». */
  clock: {
    circles: [[12, 12, 8.5]],
    paths: ['M12 7.5v4.8l3.2 2'],
  },

  /** Звезда — очки. */
  star: {
    filled: true,
    paths: [
      'M12 2.6l2.7 5.7 6.2.9-4.5 4.4 1.1 6.2L12 16.9 6.5 19.8l1.1-6.2L3.1 9.2l6.2-.9z',
    ],
  },

  /** Домик — выход в главное меню. */
  home: {
    paths: ['M3.5 11.2 12 4l8.5 7.2', 'M6 10.4V20h12v-9.6'],
  },

  /** Сердце — жизни в обычном режиме. */
  heart: {
    filled: true,
    paths: [
      'M12 21s-7.5-4.7-9.3-9.2C1.3 8.2 3.2 5 6.5 5c2 0 3.4 1.1 4.3 2.3l1.2 1.5 1.2-1.5' +
        'C14.1 6.1 15.5 5 17.5 5c3.3 0 5.2 3.2 3.8 6.8C19.5 16.3 12 21 12 21z',
    ],
  },
};

/**
 * Создаёт SVG-иконку.
 * @param {keyof typeof ICONS} name
 * @param {{size?: number, className?: string, strokeWidth?: number}} [opts]
 * @returns {SVGSVGElement}
 */
export function icon(name, opts = {}) {
  const def = ICONS[name];
  if (!def) throw new Error(`неизвестная иконка: ${name}`);

  const { size = 20, className = 'icon', strokeWidth = 1.9 } = opts;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) svg.setAttribute('class', className);

  const style = def.filled
    ? { fill: 'currentColor', stroke: 'none' }
    : {
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': String(strokeWidth),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      };

  for (const [cx, cy, r] of def.circles ?? []) {
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(r));
    for (const [k, v] of Object.entries(style)) circle.setAttribute(k, v);
    svg.append(circle);
  }

  for (const d of def.paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    for (const [k, v] of Object.entries(style)) path.setAttribute(k, v);
    svg.append(path);
  }

  return svg;
}

/** Ставит иконку внутрь элемента, заменяя прежнее содержимое. */
export function setIcon(host, name, opts) {
  host.textContent = '';
  host.append(icon(name, opts));
}
