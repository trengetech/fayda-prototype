import { ProblemSchema, type ClientApp, type Problem } from '@fayda/contracts';

/** Routes an old app must still reach, so it can read the server's levels and show "please update". */
const EXEMPT = ['/v1/health', '/v1/meta', '/v1/openapi.json'];

/**
 * Each app sends `X-Client-App` and `X-Client-Level` (the contract level it was built with). When the level is below what the
 * server accepts for that app, the answer is 426 CLIENT_TOO_OLD with a plain message, instead of a confusing failure later.
 * No header (a browser, a script, an app from before this check) or a header that cannot be read passes: the server cannot know.
 */
export function clientTooOld(url: string, headers: Record<string, string | string[] | undefined>, min: Record<ClientApp, number>): Problem | null {
  const path = url.split('?')[0] ?? url;
  if (EXEMPT.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  const app = headers['x-client-app'];
  const level = Number(headers['x-client-level']);
  if ((app !== 'buyer' && app !== 'seller') || !Number.isInteger(level) || level < 1) return null;
  if (level >= min[app]) return null;
  return ProblemSchema.parse({
    title: 'Upgrade required',
    status: 426,
    code: 'CLIENT_TOO_OLD',
    detail: 'This version of the app is too old to work with the server. Please update the app.',
  });
}
