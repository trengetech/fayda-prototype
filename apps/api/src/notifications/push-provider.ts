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
/** What happened to one message. `ticketId` is Expo's reference for checking the receipt later (it is the receipt that says a phone is gone). */
export interface PushOutcome {
  result: PushResult;
  ticketId?: string;
}
/** `pending` = the push service has not made the receipt yet, ask again later. */
export type ReceiptResult = 'ok' | 'gone' | 'failed' | 'pending';

export interface PushProvider {
  readonly name: string;
  /** True when nothing real is sent. Reported by /v1/meta so no screen pretends push works. */
  readonly simulated: boolean;
  send(messages: PushMessage[]): Promise<PushOutcome[]>;
  /** Final delivery answers for earlier tickets. Ids the service does not know yet come back `pending`. */
  receipts(ticketIds: string[]): Promise<Map<string, ReceiptResult>>;
}

/** Push is switched off: nothing is sent. The in-app notification centre and real-time badge still work. */
export class OffPushProvider implements PushProvider {
  readonly name = 'off';
  readonly simulated = true;
  async send(messages: PushMessage[]): Promise<PushOutcome[]> {
    return messages.map(() => ({ result: 'ok' as const }));
  }
  async receipts(): Promise<Map<string, ReceiptResult>> {
    return new Map();
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
    private readonly receiptsUrl = 'https://exp.host/--/api/v2/push/getReceipts',
  ) {}

  async send(messages: PushMessage[]): Promise<PushOutcome[]> {
    const out: PushOutcome[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await this.doFetch(this.url, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(chunk.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, sound: 'default', channelId: 'default', priority: 'high' }))),
        });
        if (!res.ok) {
          this.log.warn(`Expo push answered ${res.status}`);
          out.push(...chunk.map(() => ({ result: res.status >= 500 || res.status === 429 ? ('retry' as const) : ('failed' as const) })));
          continue;
        }
        const body = (await res.json()) as { data?: { status?: string; id?: string; details?: { error?: string } }[] };
        const tickets = body.data ?? [];
        out.push(
          ...chunk.map((_, k): PushOutcome => {
            const t = tickets[k];
            if (t?.status === 'ok') return { result: 'ok', ...(t.id ? { ticketId: t.id } : {}) };
            return { result: t?.details?.error === 'DeviceNotRegistered' ? 'gone' : 'failed' };
          }),
        );
      } catch (e) {
        this.log.warn(`Expo push failed: ${e instanceof Error ? e.message : 'unknown error'}`);
        out.push(...chunk.map(() => ({ result: 'retry' as const })));
      }
    }
    return out;
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', accept: 'application/json', ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}) };
  }

  /**
   * Asks for the receipts of earlier tickets (up to 1000 at a time). Expo answers only for receipts it has made; the rest are
   * `pending`. A network error leaves everything `pending`, so it is simply asked again next time. Never throws.
   */
  async receipts(ticketIds: string[]): Promise<Map<string, ReceiptResult>> {
    const out = new Map<string, ReceiptResult>(ticketIds.map((id) => [id, 'pending' as const]));
    for (let i = 0; i < ticketIds.length; i += 1000) {
      const chunk = ticketIds.slice(i, i + 1000);
      try {
        const res = await this.doFetch(this.receiptsUrl, { method: 'POST', headers: this.headers(), body: JSON.stringify({ ids: chunk }) });
        if (!res.ok) {
          this.log.warn(`Expo receipts answered ${res.status}`);
          continue;
        }
        const body = (await res.json()) as { data?: Record<string, { status?: string; details?: { error?: string } } | undefined> };
        for (const [id, r] of Object.entries(body.data ?? {})) {
          if (!r) continue;
          out.set(id, r.status === 'ok' ? 'ok' : r.details?.error === 'DeviceNotRegistered' ? 'gone' : 'failed');
        }
      } catch (e) {
        this.log.warn(`Expo receipts failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    return out;
  }}
