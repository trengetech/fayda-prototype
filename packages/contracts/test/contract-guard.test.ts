import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTRACT_LEVEL } from '../src/index.js';
import { breakingChanges, currentSnapshot, type ContractSnapshot } from './compat.js';

const FILE = fileURLToPath(new URL('../contracts.snapshot.json', import.meta.url));
const UPDATE = process.env.UPDATE_CONTRACT_SNAPSHOT === '1';

/**
 * The contract guard. `contracts.snapshot.json` is the contracts as of the last time someone said "this is the shape now".
 * 1. A change that would break an OLDER app (a removed or renamed field, a changed type, a removed route, a newly required
 *    request field) fails here until CONTRACT_LEVEL is raised in src/system.ts.
 * 2. Any other change fails until the snapshot is refreshed, so the next comparison starts from today's shape.
 * Refresh with:  pnpm --filter @fayda/contracts snapshot
 */
describe('contract guard', () => {
  it('no change that breaks an older app without raising CONTRACT_LEVEL, and the snapshot is current', () => {
    const now = currentSnapshot();
    if (UPDATE || !existsSync(FILE)) {
      writeFileSync(FILE, `${JSON.stringify(now, null, 1)}\n`);
      return;
    }
    const saved = JSON.parse(readFileSync(FILE, 'utf8')) as ContractSnapshot;
    const breaking = breakingChanges(saved, now);
    if (breaking.length && CONTRACT_LEVEL <= saved.level) {
      throw new Error(
        `These contract changes would break an older app:\n  - ${breaking.join('\n  - ')}\n\n` +
          `Raise CONTRACT_LEVEL in packages/contracts/src/system.ts (now ${CONTRACT_LEVEL}), then run:  pnpm --filter @fayda/contracts snapshot\n` +
          `If you are sure no released app can be hurt, you still raise it: it is one number, and an old app then shows "please update" instead of errors.`,
      );
    }
    expect(
      JSON.stringify(now) === JSON.stringify(saved),
      'The contracts changed. Refresh the snapshot with:  pnpm --filter @fayda/contracts snapshot   (and commit contracts.snapshot.json)',
    ).toBe(true);
  });
});

describe('what counts as breaking', () => {
  const snap = (schemas: ContractSnapshot['schemas'], routes: string[] = ['GET /v1/a']): ContractSnapshot => ({ level: 1, routes, schemas });
  const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
  const resp = (s: unknown) => ({ request: false, schema: s });
  const req = (s: unknown) => ({ request: true, schema: s });

  it('removing or renaming a field, changing its type, or removing a route breaks an older app', () => {
    const before = snap({ A: resp(obj({ id: { type: 'string' }, price: { type: 'integer' } })) });
    expect(breakingChanges(before, snap({ A: resp(obj({ id: { type: 'string' } })) }))).toEqual(['A.price: field removed or renamed']);
    expect(breakingChanges(before, snap({ A: resp(obj({ id: { type: 'string' }, price: { type: 'string' } })) }))).toEqual(['A.price: type changed from "integer" to "string"']);
    expect(breakingChanges(before, snap({}))).toEqual(['A: schema removed or renamed']);
    expect(breakingChanges(before, snap({ A: before.schemas.A! }, []))).toEqual(['route removed: GET /v1/a']);
  });

  it('looks inside nested objects, lists and alternatives', () => {
    const before = snap({ A: resp(obj({ items: { type: 'array', items: obj({ n: { type: 'integer' } }) }, owner: { anyOf: [obj({ name: { type: 'string' } }), { type: 'null' }] } })) });
    const after = snap({ A: resp(obj({ items: { type: 'array', items: obj({}) }, owner: { anyOf: [obj({}), { type: 'null' }] } })) });
    expect(breakingChanges(before, after)).toEqual(['A.items[].n: field removed or renamed', 'A.owner|0.name: field removed or renamed']);
  });

  it('removing an allowed value breaks; adding one does not', () => {
    const before = snap({ A: resp(obj({ s: { type: 'string', enum: ['A', 'B'] } })) });
    expect(breakingChanges(before, snap({ A: resp(obj({ s: { type: 'string', enum: ['A'] } })) }))).toEqual(['A.s: allowed value(s) removed: B']);
    expect(breakingChanges(before, snap({ A: resp(obj({ s: { type: 'string', enum: ['A', 'B', 'C'] } })) }))).toEqual([]);
  });

  it('a new field in a response does not break an older app', () => {
    const before = snap({ A: resp(obj({ id: { type: 'string' } }, ['id'])) });
    expect(breakingChanges(before, snap({ A: resp(obj({ id: { type: 'string' }, extra: { type: 'integer' } }, ['id', 'extra'])) }))).toEqual([]);
  });

  it('a newly required field breaks only in something the app sends', () => {
    const body = (required: string[]) => obj({ a: { type: 'string' }, b: { type: 'string' } }, required);
    expect(breakingChanges(snap({ A: req(body(['a'])) }), snap({ A: req(body(['a', 'b'])) }))).toEqual(['A.b: now required in a request an older app sends']);
    expect(breakingChanges(snap({ A: req(body(['a'])) }), snap({ A: req(body(['a'])) }))).toEqual([]);
  });

  it('the real contracts compare equal to themselves', () => {
    expect(breakingChanges(currentSnapshot(), currentSnapshot())).toEqual([]);
  });
});
