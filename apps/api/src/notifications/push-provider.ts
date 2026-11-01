import { Logger } from '@nestjs/common';

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}
/** `ok`, or `gone` when the phone no longer wants pushes (app removed), so its token is deleted. `retry` is a temporary failure. */
export type PushResult = 'ok' | 'gone' | 'retry' | 'failed';

export interface PushProvider {
  readonly name: string;
  /** True when nothing real is sent. Reported by /v1/meta so no screen pretends push works. */
  readonly simulated: boolean;
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

/** Push is switched off: nothing is sent. The in-app notification centre and real-time badge still work. */
export class OffPushProvider implements PushProvider {
  readonly name = 'off';
  readonly simulated = true;
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    return messages.map(() => 'ok' as const);
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Sends through the Expo push service, which reaches Android (FCM) and iOS (APNs) with one request shape. Chunks of 100,
 * as the service requires. A failure never throws: push is best effort, the notification centre is the record.
 */
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  readonly simulated = false;
  private readonly log = new Logger('Push');
  constructor(
    private readonly accessToken: string | null = null,
    private readonly doFetch: Fetch = (url, init) => fetch(url, init) as ReturnType<Fetch>,
    private readonly url = 'https://exp.host/--/api/v2/push/send',
  ) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const out: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await this.doFetch(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}) },
          body: JSON.stringify(chunk.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: 'default', channelId: 'default', priority: 'high' }))),
        });
        if (!res.ok) {
          this.log.warn(`Expo push answered ${res.status}`);
          out.push(...chunk.map(() => (res.status >= 500 || res.status === 429 ? ('retry' as const) : ('failed' as const))));
          continue;
        }
        const body = (await res.json()) as { data?: { status?: string; details?: { error?: string } }[] };
        const tickets = body.data ?? [];
        out.push(...chunk.map((_, k) => (tickets[k]?.status === 'ok' ? ('ok' as const) : tickets[k]?.details?.error === 'DeviceNotRegistered' ? ('gone' as const) : ('failed' as const))));
      } catch (e) {
        this.log.warn(`Expo push failed: ${e instanceof Error ? e.message : 'unknown error'}`);
        out.push(...chunk.map(() => 'retry' as const));
      }
    }
    return out;
  }
}
