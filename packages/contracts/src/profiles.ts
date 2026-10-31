import { z } from './zod.js';

export const CATEGORY_NAMES = ['Ethnic wear', 'Western wear', 'Menswear', 'Accessories', 'Footwear'] as const;
export const CONFIRM_HOURS = [1, 2, 4, 6, 12, 24, 48] as const;
export const SHIP_DAYS = [1, 2, 3, 5, 7] as const;

export const ContactInputSchema = z.object({ phone: z.string().max(16).nullish(), whatsapp: z.string().max(16).nullish() }).openapi('ContactInput');
export const ContactSchema = z.object({ phone: z.string().nullable(), whatsapp: z.string().nullable() }).openapi('Contact');
export type Contact = z.infer<typeof ContactSchema>;

export const AddressInputSchema = z
  .object({
    name: z.string().max(80),
    line1: z.string().max(120),
    line2: z.string().max(120),
    pin: z.string().max(10),
    city: z.string().max(60),
    state: z.string().max(60),
  })
  .openapi('AddressInput');
export const AddressSchema = AddressInputSchema.extend({ id: z.string() }).openapi('Address');

// ---------- buyer ----------
export const BuyerProfileInputSchema = z
  .object({
    name: z.string().max(80),
    address: AddressInputSchema,
    contact: ContactInputSchema,
    agreementAccepted: z.boolean(),
  })
  .openapi('BuyerProfileInput');
export type BuyerProfileInput = z.infer<typeof BuyerProfileInputSchema>;

export const BuyerContactUpdateSchema = z.object({ contact: ContactInputSchema }).openapi('BuyerContactUpdate');

export const BuyerProfileSchema = z
  .object({
    name: z.string().nullable(),
    addresses: z.array(AddressSchema),
    defaultAddressId: z.string().nullable(),
    contact: ContactSchema,
    agreementVersion: z.string().nullable(),
    agreementAcceptedAt: z.number().nullable(),
    missing: z.array(z.string()),
  })
  .openapi('BuyerProfile');
export type BuyerProfile = z.infer<typeof BuyerProfileSchema>;

// ---------- seller ----------
export const SellerShopInputSchema = z
  .object({
    sellerType: z.enum(['INDIVIDUAL', 'BUSINESS']),
    name: z.string().max(80),
    handle: z.string().max(40),
    area: z.string().max(80),
    city: z.string().max(60).nullish(),
    gstin: z.string().max(20).nullish(),
    bio: z.string().max(400).nullish(),
    // Step 1 ends with categories; step 2 adds location, contact and declared times. All are sent together.
    categories: z.array(z.string()).max(10),
    mapsUrl: z.string().max(500),
    googleProfileUrl: z.string().max(500).nullish(),
    socialUrl: z.string().max(500).nullish(),
    contact: ContactInputSchema,
    sla: z.object({ confirmHours: z.number(), shipDays: z.number() }),
  })
  .openapi('SellerShopInput');
export type SellerShopInput = z.infer<typeof SellerShopInputSchema>;

/** Payment details (step 3). A UPI QR image is added in a later change, with the upload-intent flow. */
export const PaymentInputSchema = z
  .object({
    upiId: z.string().max(100).nullish(),
    /** A READY `UPI_QR` upload of this seller. Needs `upiQrPayload`, the text the phone decoded from it. */
    upiQrMediaId: z.string().uuid().nullish(),
    upiQrPayload: z.string().max(500).nullish(),
    bankHolder: z.string().max(100).nullish(),
    bankAccount: z.string().max(30).nullish(),
    bankIfsc: z.string().max(15).nullish(),
    bankName: z.string().max(100).nullish(),
    paymentLink: z.string().max(500).nullish(),
    website: z.string().max(500).nullish(),
    /** The Code of Conduct is accepted together with payment details, which complete onboarding. */
    conductAccepted: z.boolean(),
  })
  .openapi('PaymentInput');
export type PaymentInput = z.infer<typeof PaymentInputSchema>;

export const PaymentProfileSchema = z
  .object({
    upiId: z.string().nullable(),
    upiQrMediaId: z.string().nullable(),
    bankHolder: z.string().nullable(),
    bankAccount: z.string().nullable(),
    bankIfsc: z.string().nullable(),
    bankName: z.string().nullable(),
    paymentLink: z.string().nullable(),
    website: z.string().nullable(),
  })
  .openapi('PaymentProfile');

export const SellerProfileSchema = z
  .object({
    id: z.string(),
    sellerType: z.enum(['INDIVIDUAL', 'BUSINESS']),
    name: z.string(),
    handle: z.string(),
    area: z.string(),
    city: z.string(),
    gstin: z.string().nullable(),
    bio: z.string(),
    categories: z.array(z.string()),
    mapsUrl: z.string(),
    googleProfileUrl: z.string().nullable(),
    socialUrl: z.string().nullable(),
    contact: ContactSchema,
    sla: z.object({ confirmHours: z.number(), shipDays: z.number() }),
    payment: PaymentProfileSchema.nullable(),
    conductAcceptedAt: z.number().nullable(),
    missing: z.array(z.string()),
  })
  .openapi('SellerProfile');
export type SellerProfile = z.infer<typeof SellerProfileSchema>;
