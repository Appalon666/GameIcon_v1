/**
 * Генерирует красивые фоны для меню процедурно (SVG → PNG через sharp).
 * Полностью свои — без лицензий и атрибуции, в палитре игры. Несколько
 * вариантов, чтобы выбрать. Итог — screenshots/bg-*.png (превью).
 *
 * Если вариант понравится: скопировать в public/img/menu-bg.jpg и включить в CSS.
 *
 * Запуск: node scripts/make-bg.mjs
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { ROOT } from './lib.mjs';

const OUT = join(ROOT, 'screenshots');
const W = 1600;
const H = 1000;

// Простой генератор псевдослучайных чисел с сидом — фоны воспроизводимы.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function glow(cx, cy, r, color, op) {
  return `<radialGradient id="g${cx}${cy}${r}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${color}" stop-opacity="${op}"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
    <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.8}" fill="url(#g${cx}${cy}${r})"/>`;
}

function particles(rand, n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = Math.round(rand() * W);
    const y = Math.round(rand() * H);
    const r = (rand() * rand() * 2.4 + 0.4).toFixed(2);
    const op = (rand() * 0.35 + 0.05).toFixed(2);
    const blue = rand() > 0.4;
    const color = blue ? '#8fd3ff' : '#ffffff';
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="${op}"/>`;
  }
  return out;
}

/**
 * @param {object} v описание варианта
 */
function svg(v) {
  const rand = rng(v.seed);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      ${v.base.map((c, i) => `<stop offset="${(i / (v.base.length - 1)) * 100}%" stop-color="${c}"/>`).join('')}
    </linearGradient>
    <pattern id="hex" width="56" height="48" patternUnits="userSpaceOnUse" patternTransform="scale(1.4)">
      <path d="M14 0 L42 0 L56 24 L42 48 L14 48 L0 24 Z" fill="none"
            stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>
    </pattern>
    <radialGradient id="vign" cx="50%" cy="42%" r="75%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="${v.vignette}"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#base)"/>
  <rect width="${W}" height="${H}" fill="url(#hex)"/>
  ${v.glows.map((g) => glow(g[0], g[1], g[2], g[3], g[4])).join('\n  ')}
  ${particles(rand, v.particles)}
  ${v.motif ? `<text x="${v.motif.x}" y="${v.motif.y}" font-family="Arial, sans-serif" font-size="900" font-weight="800" fill="#66c0f4" opacity="0.05" text-anchor="middle">?</text>` : ''}
  <rect width="${W}" height="${H}" fill="url(#vign)"/>
</svg>`;
}

const VARIANTS = [
  {
    name: 'bg-1-aurora',
    seed: 7,
    base: ['#0e1622', '#0b0f18'],
    glows: [
      [520, 180, 620, '#2a8fd8', 0.55],
      [1250, 780, 720, '#1f6fb0', 0.45],
      [900, 380, 420, '#66c0f4', 0.25],
    ],
    particles: 150,
    vignette: 0.55,
    motif: null,
  },
  {
    name: 'bg-2-spotlight',
    seed: 21,
    base: ['#0c131e', '#080b12'],
    glows: [
      [800, 340, 760, '#2f9be0', 0.5],
      [800, 340, 300, '#8fd3ff', 0.28],
    ],
    particles: 120,
    vignette: 0.7,
    motif: { x: 800, y: 720 },
  },
  {
    name: 'bg-3-nebula',
    seed: 42,
    base: ['#101020', '#0a0a14'],
    glows: [
      [380, 720, 640, '#3b6fd0', 0.5],
      [1240, 260, 640, '#2aa0d8', 0.5],
      [820, 500, 360, '#7b5cff', 0.22],
    ],
    particles: 170,
    vignette: 0.6,
    motif: null,
  },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const v of VARIANTS) {
    const buf = Buffer.from(svg(v));
    await sharp(buf).jpeg({ quality: 86, mozjpeg: true }).toFile(join(OUT, `${v.name}.jpg`));
    console.log(`[bg] ${v.name}.jpg`);
  }
  console.log(`\n[bg] готово: ${VARIANTS.length} фона в screenshots/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
