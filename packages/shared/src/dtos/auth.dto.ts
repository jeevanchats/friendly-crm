import { z } from 'zod';

export const RequestOtpSchema = z.object({
  phone: z.string().min(10, 'Phone number must be at least 10 digits').max(15),
  countryCode: z.string().default('+91'),
});

export type RequestOtpDto = z.infer<typeof RequestOtpSchema>;

export const VerifyOtpSchema = z.object({
  phone: z.string().min(10).max(15),
  code: z.string().length(6, 'OTP must be 6 digits'),
  tenantId: z.string().uuid().optional(),
});

export type VerifyOtpDto = z.infer<typeof VerifyOtpSchema>;

export const AuthSessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  user: z.object({
    id: z.string().uuid(),
    phone: z.string(),
    name: z.string().nullable(),
    email: z.string().email().nullable(),
    role: z.string(),
    tenantId: z.string().uuid().nullable().optional(),
  }),
});

export type AuthSessionDto = z.infer<typeof AuthSessionSchema>;
