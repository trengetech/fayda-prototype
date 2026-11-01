import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iconShapes } from '../src/icon-shapes';

const src = readFileSync(join(import.meta.dirname, '../../../prototype/src/ui-core.js'), 'utf8');
const block = src.slice(src.indexOf('const ICONS = {'), src.indexOf('\n  };', src.indexOf('const ICONS = {')));
const protoNames = [...block.matchAll(/^\s{4}(\w+): '/gm)].map((m) => m[1]!);

describe('icon set', () => {
  it('has every icon the prototype draws (so a new prototype icon cannot be forgotten)', () => {
    expect(protoNames.length).toBeGreaterThan(30);
    for (const n of protoNames) expect(Object.keys(iconShapes), n).toContain(n);
  });
  it('draws each prototype icon with the same number of shapes', () => {
    for (const n of protoNames) {
      const line = block.split('\n').find((l) => l.trim().startsWith(`${n}: '`))!;
      const shapes = (line.match(/<(path|circle|rect|polygon)\b/g) ?? []).length;
      expect((iconShapes as Record<string, readonly unknown[]>)[n]!.length, n).toBe(shapes);
    }
  });
});
