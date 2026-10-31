import { z } from './zod.js';

/** Each app signs in on its own. A phone number is one user across both. */
export const AppAudienceSchema = z.enum(['buyer', 'seller']).openapi('AppAudience');
export type AppAudience = z.infer<typeof AppAudienceSchema>;

const PhoneField = z.string().min(10).max(16).openapi({ description: '10-digit Indian mobile, with or without +91', example: '9876543210' });

export const OtpRequestSchema = z.object({ phone: PhoneField, app: AppAudienceSchema }).openapi('OtpRequest');
export type OtpRequest = z.infer<typeof OtpRequestSchema>;

export const OtpRequestedSchema = z
  .object({
    sent: z.literal(true),
    /** True while the code is a fixed development code and no SMS is sent. Apps must say so. */
    simulated: z.boolean(),
  })
  .openapi('OtpRequested');
export type OtpRequested = z.infer<typeof OtpRequestedSchema>;

export const OtpVerifySchema = z.object({ phone: PhoneField, code: z.string().min(4).max(8), app: AppAudienceSchema }).openapi('OtpVerify');
export type OtpVerify = z.infer<typeof OtpVerifySchema>;

export const RefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).openapi('Refresh');
export type Refresh = z.infer<typeof RefreshSchema>;

export const UserSchema = z.object({ id: z.string(), phone: z.string(), name: z.string().nullable() }).openapi('User');
export type User = z.infer<typeof UserSchema>;

/** Fields the user still has to fill in. Empty means complete. Older accounts get new required fields here instead of being locked out. */
export const ProfileStatusSchema = z.object({ complete: z.boolean(), missing: z.array(z.string()) }).openapi('ProfileStatus');
export type ProfileStatus = z.infer<typeof ProfileStatusSchema>;

export const AuthResultSchema = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresInSeconds: z.number().int().positive(),
    user: UserSchema,
    app: AppAudienceSchema,
    profile: ProfileStatusSchema,
  })
  .openapi('AuthResult');
export type AuthResult = z.infer<typeof AuthResultSchema>;

export const MeSchema = z.object({ user: UserSchema, app: AppAudienceSchema, profile: ProfileStatusSchema }).openapi('Me');
export type Me = z.infer<typeof MeSchema>;
