import { z } from 'zod';
import * as contracts from '../src/index.js';

/** Everything an older app could depend on: which routes exist, and the shape of every contract schema. */
export interface ContractSnapshot {
  level: number;
  routes: string[];
  /** Schema export name (without "Schema") to its JSON Schema. `request: true` for schemas an app sends to the server. */
  schemas: Record<string, { request: boolean; schema: unknown }>;
}

type Json = Record<string, unknown>;

export function currentSnapshot(): ContractSnapshot {
  const doc = contracts.buildOpenApiDocument('snapshot') as unknown as { paths: Record<string, Record<string, Json>> };
  const routes: string[] = [];
  const requestRefs = new Set<string>();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      routes.push(`${method.toUpperCase()} ${path}`);
      const body = JSON.stringify((op as { requestBody?: unknown }).requestBody ?? {});
      for (const m of body.matchAll(/#\/components\/schemas\/(\w+)/g)) requestRefs.add(m[1]!);
    }
  }
  const schemas: ContractSnapshot['schemas'] = {};
  for (const [name, value] of Object.entries(contracts).sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.endsWith('Schema') || !(value instanceof z.ZodType)) continue;
    const key = name.slice(0, -'Schema'.length);
    const request = requestRefs.has(key) || /(Input|Query)$/.test(key);
    schemas[key] = { request, schema: z.toJSONSchema(value, { unrepresentable: 'any', io: request ? 'input' : 'output' }) };
  }
  return { level: contracts.CONTRACT_LEVEL, routes: routes.sort(), schemas };
}

const asObj = (x: unknown): Json | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Json) : null);
const typeOf = (s: Json): string => JSON.stringify(s.type ?? (s.anyOf ? 'anyOf' : s.enum ? 'enum' : s.const !== undefined ? 'const' : 'any'));

/** Walks two JSON Schemas and lists what would break an app built on the old one. */
function compare(path: string, oldS: unknown, newS: unknown, request: boolean, out: string[]): void {
  const o = asObj(oldS);
  const n = asObj(newS);
  if (!o || !n) return;
  if (typeOf(o) !== typeOf(n)) {
    out.push(`${path}: type changed from ${typeOf(o)} to ${typeOf(n)}`);
    return;
  }
  if (Array.isArray(o.enum) && Array.isArray(n.enum)) {
    const gone = (o.enum as unknown[]).filter((v) => !(n.enum as unknown[]).includes(v));
    if (gone.length) out.push(`${path}: allowed value(s) removed: ${gone.join(', ')}`);
  }
  const op = asObj(o.properties);
  const np = asObj(n.properties);
  if (op) {
    for (const key of Object.keys(op)) {
      if (!np || !(key in np)) out.push(`${path}.${key}: field removed or renamed`);
      else compare(`${path}.${key}`, op[key], np[key], request, out);
    }
  }
  if (request && np) {
    const oldReq = new Set((o.required as string[] | undefined) ?? []);
    for (const key of (n.required as string[] | undefined) ?? []) if (!oldReq.has(key)) out.push(`${path}.${key}: now required in a request an older app sends`);
  }
  if (o.items) compare(`${path}[]`, o.items, n.items, request, out);
  const oa = (o.anyOf ?? o.oneOf) as unknown[] | undefined;
  const na = (n.anyOf ?? n.oneOf) as unknown[] | undefined;
  if (oa && na) {
    if (na.length < oa.length) out.push(`${path}: an alternative was removed`);
    else oa.forEach((a, i) => compare(`${path}|${i}`, a, na[i], request, out));
  }
}

/** Changes that would break an older app (or an older app's requests). Additions to responses are not listed: older apps ignore them. */
export function breakingChanges(oldSnap: ContractSnapshot, newSnap: ContractSnapshot): string[] {
  const out: string[] = [];
  for (const route of oldSnap.routes) if (!newSnap.routes.includes(route)) out.push(`route removed: ${route}`);
  for (const [name, old] of Object.entries(oldSnap.schemas)) {
    const now = newSnap.schemas[name];
    if (!now) out.push(`${name}: schema removed or renamed`);
    else compare(name, old.schema, now.schema, old.request, out);
  }
  return out;
}
