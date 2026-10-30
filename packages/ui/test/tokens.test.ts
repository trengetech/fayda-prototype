import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dark, heights, light, radii, type Palette } from '../src/tokens';

const css = readFileSync(join(import.meta.dirname, '../../../prototype/src/styles.css'), 'utf8');

const camel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
function vars(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [camel(m[1]!), m[2]!.trim().toUpperCase()]));
}
// The first :root block is light; the explicit dark theme block is dark.
const lightVars = vars(/:root\s*\{([^}]*)\}/.exec(css)![1]!);
// Dark only overrides some variables; the rest (e.g. --on-accent) inherit from :root, as in the browser.
const darkVars = { ...lightVars, ...vars(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css)![1]!) };

const upper = (p: Palette) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.toUpperCase()]));

describe('tokens match prototype/src/styles.css', () => {
  it.each([['light', light, lightVars], ['dark', dark, darkVars]] as const)('%s palette', (_n, palette, cssVars) => {
    for (const [name, value] of Object.entries(upper(palette))) {
      expect(cssVars[name], `--${name}`).toBe(value);
    }
  });

  it('radii', () => {
    const r = vars(/:root\s*\{([^}]*)\}/.exec(css)![1]!);
    expect([r.rSm, r.rMd, r.rLg, r.rXl]).toEqual([radii.sm, radii.md, radii.lg, radii.xl].map((n) => `${n}PX`));
  });

  it('control heights', () => {
    const h = (sel: string) => Number(new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^}]*?\\bheight:\\s*(\\d+)px`).exec(css)?.[1]);
    expect(h('.btn')).toBe(heights.btn);
    expect(h('.btn.lg')).toBe(heights.btnLg);
    expect(h('.btn.sm')).toBe(heights.btnSm);
    expect(h('.input')).toBe(heights.input);
    expect(h('.iconbtn')).toBe(heights.iconButton);
    expect(h('.chip')).toBe(heights.chip);
    expect(h('.badge')).toBe(heights.badge);
  });
});

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };

describe('text contrast (WCAG AA 4.5:1 for body text)', () => {
  it.each([['light', light], ['dark', dark]] as const)('%s: ink and muted on surfaces', (_n, p) => {
    expect(contrast(p.ink, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.muted, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.muted, p.surface2)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.accentStrong, p.accentTint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.danger, p.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
