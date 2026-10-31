import { createServer, type Server as Http } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { afterEach, describe, expect, it } from 'vitest';
import { startRealtime } from '../src/realtime';

let http: Http;
let io: Server;
const closers: (() => void)[] = [];
afterEach(async () => {
  closers.splice(0).forEach((c) => c());
  io?.close();
  await new Promise((r) => http?.close(r));
});

async function server(accept: (token: unknown) => boolean) {
  http = createServer();
  io = new Server(http);
  const seen: unknown[] = [];
  io.use((s, next) => {
    seen.push(s.handshake.auth.token);
    next(accept(s.handshake.auth.token) ? undefined : new Error('UNAUTHENTICATED'));
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, seen };
}
const until = async (f: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('startRealtime', () => {
  it('sends the access token, reports connection, and passes on negotiation updates', async () => {
    const { url, seen } = await server((t) => t === 'tok-1');
    const updates: unknown[] = [];
    let connects = 0;
    const rt = startRealtime({ baseUrl: url, getAccessToken: () => 'tok-1', refreshAccessToken: async () => null, onUpdate: (e) => updates.push(e), onConnect: () => connects++ });
    closers.push(rt.close);
    await until(() => connects === 1);
    expect(seen).toEqual(['tok-1']);
    io.emit('negotiation.updated', { negotiationId: 'n1', listingId: 'l1' });
    await until(() => updates.length === 1);
    expect(updates[0]).toEqual({ negotiationId: 'n1', listingId: 'l1' });
  });

  it('refreshes an expired token once and connects again', async () => {
    const { url, seen } = await server((t) => t === 'fresh');
    let token = 'stale';
    let refreshes = 0;
    let connects = 0;
    const rt = startRealtime({
      baseUrl: url,
      getAccessToken: () => token,
      refreshAccessToken: async () => ((refreshes++, (token = 'fresh'))),
      onUpdate: () => undefined,
      onConnect: () => connects++,
    });
    closers.push(rt.close);
    await until(() => connects === 1);
    expect(refreshes).toBe(1);
    expect(seen).toEqual(['stale', 'fresh']);
  });

  it('gives up quietly when the refresh fails, instead of retrying forever', async () => {
    const { url, seen } = await server(() => false);
    let refreshes = 0;
    const rt = startRealtime({ baseUrl: url, getAccessToken: () => 'bad', refreshAccessToken: async () => (refreshes++, null), onUpdate: () => undefined });
    closers.push(rt.close);
    await until(() => refreshes === 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(refreshes).toBe(1);
    expect(seen).toEqual(['bad']);
  });

  it('passes order, chat and request events to onEvent, and negotiation events to both callbacks', async () => {
    const { url } = await server(() => true);
    const events: unknown[] = [];
    const updates: unknown[] = [];
    let connects = 0;
    const rt = startRealtime({ baseUrl: url, getAccessToken: () => 't', refreshAccessToken: async () => null, onUpdate: (e) => updates.push(e), onEvent: (e) => events.push(e), onConnect: () => connects++ });
    closers.push(rt.close);
    await until(() => connects === 1);
    io.emit('order.updated', { orderId: 'o1' });
    io.emit('chat.updated', { threadId: 't1' });
    io.emit('request.updated', { requestId: 'r1' });
    io.emit('negotiation.updated', { negotiationId: 'n1', listingId: 'l1' });
    await until(() => events.length === 4);
    expect(events).toEqual([
      { name: 'order.updated', orderId: 'o1' },
      { name: 'chat.updated', threadId: 't1' },
      { name: 'request.updated', requestId: 'r1' },
      { name: 'negotiation.updated', negotiationId: 'n1', listingId: 'l1' },
    ]);
    expect(updates).toEqual([{ negotiationId: 'n1', listingId: 'l1' }]);
  });
});
