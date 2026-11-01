// Flat-colour product illustrations for the demo listings (no gradients). Shapes are the prototype's garments
// (prototype/src/ui-core.js, GARMENTS), drawn with its palettes. These are illustrated stand-ins, not photographs:
// real sellers upload their own pictures and videos. Needs `rsvg-convert` (brew install librsvg) to make PNGs.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PALETTES = {
  indigo: { bg1: '#EFE5D2', bg2: '#D6C4A2', g: '#27357A', p: '#E9E4D8' }, clay: { bg1: '#F6E1CF', bg2: '#E4B48E', g: '#B5552B', p: '#F7E6D6' },
  rose: { bg1: '#F8E2E7', bg2: '#E6AFBD', g: '#B83B5E', p: '#F6D59A' }, sage: { bg1: '#E8EDE0', bg2: '#C4D0B2', g: '#5F7150', p: '#EEF1E6' },
  sand: { bg1: '#F2EADD', bg2: '#D8C7AB', g: '#FBF8F1', p: '#C2AE8E' }, teal: { bg1: '#DCEFEC', bg2: '#9FCFCA', g: '#0F6E6E', p: '#F2C14E' },
  plum: { bg1: '#ECE3F4', bg2: '#C6B1DE', g: '#A7ADB4', p: '#5B4B7A' }, maroon: { bg1: '#F4DEDA', bg2: '#D9A69F', g: '#7A1F2B', p: '#E6B85C' },
  tan: { bg1: '#F3E6D4', bg2: '#DCC09A', g: '#9A5B2E', p: '#E8C79A' },
};
const GARMENTS = {
  kurta: { body: ['M85 18 Q100 34 115 18 L140 28 L172 92 L150 102 L136 72 L146 226 L54 226 L64 72 L50 102 L28 92 L60 28 Z'], lines: ['M100 30 L100 82'], bands: ['M54 212 L146 212 L146 226 L54 226 Z'] },
  shirt: { body: ['M80 20 L100 36 L120 20 L144 30 L172 88 L152 98 L140 72 L142 204 L58 204 L60 72 L48 98 L28 88 L56 30 Z'], lines: ['M80 20 L92 46 L100 36 L108 46 L120 20', 'M100 46 L100 200'], dots: [[100, 70, 3], [100, 100, 3], [100, 130, 3], [100, 160, 3]] },
  coord: { body: ['M82 14 Q100 28 118 14 L142 24 L164 70 L146 78 L136 58 L138 106 L62 106 L64 58 L54 78 L36 70 L58 24 Z', 'M64 114 L136 114 L148 232 L110 232 L100 150 L90 232 L52 232 Z'], lines: ['M100 120 L100 150'] },
  saree: { body: ['M70 18 Q100 8 130 20 L150 70 Q160 130 152 232 L48 232 Q40 140 58 70 Z'], bands: ['M70 18 L152 118 L152 150 L60 38 Z', 'M48 216 L152 216 L152 232 L48 232 Z'] },
  dupatta: { body: ['M40 28 Q100 8 160 28 Q150 120 168 222 Q100 202 32 224 Q50 120 40 28 Z'], bands: ['M40 28 Q100 8 160 28 L159 40 Q100 20 41 40 Z', 'M34 210 Q100 190 166 208 L168 222 Q100 202 32 224 Z'] },
  jhumka: { body: ['M40 120 Q65 76 90 120 Z', 'M110 120 Q135 76 160 120 Z'], lines: ['M65 40 Q52 52 65 66 L65 80', 'M135 40 Q122 52 135 66 L135 80'], dots: [[65, 84, 9], [135, 84, 9], [44, 128, 5], [56, 132, 5], [65, 134, 5], [74, 132, 5], [86, 128, 5], [114, 128, 5], [126, 132, 5], [135, 134, 5], [144, 132, 5], [156, 128, 5]] },
  potli: { body: ['M60 92 Q100 72 140 92 Q172 170 140 222 Q100 238 60 222 Q28 170 60 92 Z'], lines: ['M66 96 Q100 112 134 96', 'M84 86 Q66 44 92 30', 'M116 86 Q134 44 108 30'], dots: [[100, 160, 10], [78, 150, 4], [122, 150, 4], [100, 190, 4]] },
  sandal: { body: ['M60 26 Q86 18 92 58 L92 196 Q88 226 62 226 Q36 226 34 196 L34 58 Q36 22 60 26 Z', 'M140 26 Q166 18 172 58 L172 196 Q168 226 142 226 Q116 226 114 196 L114 58 Q116 22 140 26 Z'], bands: ['M34 86 Q63 66 92 86 L92 104 Q63 84 34 104 Z', 'M114 86 Q143 66 172 86 L172 104 Q143 84 114 104 Z'], dots: [[63, 50, 6], [143, 50, 6]] },
};

/** What each demo listing shows, and whether it also gets a 60-second reel. */
export const DEMO_ART = {
  'Hand-block printed cotton kurta': { scene: 'kurta', palette: 'indigo', reel: true },
  'Dabu print mul dupatta': { scene: 'dupatta', palette: 'clay', reel: false },
  'Chanderi silk kurta set': { scene: 'kurta', palette: 'rose', reel: true },
  'Linen co-ord set': { scene: 'coord', palette: 'sage', reel: true },
  'Mul cotton shirt': { scene: 'shirt', palette: 'sand', reel: false },
  'Pochampally ikat silk saree': { scene: 'saree', palette: 'teal', reel: false },
  'Oxidised silver jhumkas': { scene: 'jhumka', palette: 'plum', reel: true },
  'Hand-embroidered potli bag': { scene: 'potli', palette: 'maroon', reel: false },
  'Leather Kolhapuri sandals': { scene: 'sandal', palette: 'tan', reel: true },
};

const garment = (scene, P, id) => {
  const G = GARMENTS[scene];
  const lineCol = scene === 'jhumka' ? P.g : P.p;
  return `<defs><pattern id="${id}p" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="9" cy="9" r="2.4" fill="${P.p}"/><circle cx="0" cy="0" r="1.3" fill="${P.p}"/><circle cx="18" cy="18" r="1.3" fill="${P.p}"/></pattern>
<clipPath id="${id}c">${G.body.map((d) => `<path d="${d}"/>`).join('')}</clipPath></defs>
${G.body.map((d) => `<path d="${d}" fill="${P.g}"/>`).join('')}
<rect width="200" height="240" fill="url(#${id}p)" clip-path="url(#${id}c)" opacity="0.5"/>
${(G.bands || []).map((d) => `<path d="${d}" fill="${P.p}" opacity="0.9"/>`).join('')}
${(G.lines || []).map((d) => `<path d="${d}" fill="none" stroke="${lineCol}" stroke-width="3" stroke-linecap="round" opacity="0.85"/>`).join('')}
${(G.dots || []).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${lineCol}"/>`).join('')}`;
};

/** One flat picture. `view`: 'front' (garment centred), 'detail' (close-up of the print), 'flat' (tilted on a dark table). */
export function svgFor({ scene, palette }, view, w, h) {
  const P = PALETTES[palette];
  const cx = w / 2, cy = h / 2;
  const k = Math.min(w / 200, h / 240);
  let bg = P.bg1, back = '', s = k * 0.82, rot = 0, shiftY = -h * 0.02;
  if (view === 'front') back = `<circle cx="${cx}" cy="${cy - h * 0.04}" r="${w * 0.4}" fill="${P.bg2}"/><ellipse cx="${cx}" cy="${cy + 120 * s * 0.5 + h * 0.04}" rx="${w * 0.26}" ry="${h * 0.018}" fill="${P.g}" opacity="0.16"/>`;
  if (view === 'detail') { bg = P.bg2; s = k * 1.9; shiftY = h * 0.02; }
  if (view === 'flat') { bg = '#24262B'; s = k * 0.74; rot = -9; back = `<rect x="${w * 0.08}" y="${h * 0.08}" width="${w * 0.84}" height="${h * 0.84}" rx="${w * 0.04}" fill="#2F3238"/>`; }
  const tx = cx - 100 * s, ty = cy - 120 * s + shiftY;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${back}
<g transform="translate(${tx} ${ty}) rotate(${rot} ${100 * s} ${120 * s}) scale(${s})">${garment(scene, P, 'g' + view)}</g></svg>`;
}

/** Writes the PNG for one view to `dir` and returns its path. */
export function renderPng(dir, name, art, view, w, h) {
  const svg = join(dir, `${name}.svg`), png = join(dir, `${name}.png`);
  writeFileSync(svg, svgFor(art, view, w, h));
  execFileSync('rsvg-convert', ['-w', String(w), '-h', String(h), svg, '-o', png]);
  return png;
}
