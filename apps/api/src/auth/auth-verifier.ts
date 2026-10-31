import { Injectable } from '@nestjs/common';

export const AUTH_VERIFIER = Symbol('AUTH_VERIFIER');

/** Proves a person controls a phone number. Supabase Auth will replace the development implementation. */
export interface AuthVerifier {
  readonly name: string;
  /** True when no real SMS is sent and the code is fixed. Reported by /v1/meta and shown in the apps. */
  readonly simulated: boolean;
  /** Sends the code. Resolves when it is on its way. */
  start(phone: string): Promise<void>;
  verify(phone: string, code: string): Promise<boolean>;
}

/** SIMULATED sign-in: every number accepts the code 123456 and no SMS is sent. Never label this as real. */
@Injectable()
export class DevOtpVerifier implements AuthVerifier {
  static readonly CODE = '123456';
  readonly name = 'dev-otp';
  readonly simulated = true;
  async start(): Promise<void> {}
  async verify(_phone: string, code: string): Promise<boolean> {
    return code === DevOtpVerifier.CODE;
  }
}
