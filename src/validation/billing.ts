import { z } from 'zod';

// Schemas for /v1/billing. Whether a URL may be used (BILLING_RETURN_ORIGINS)
// is BillingService's call; these only check the request's shape.

const priceId = z
  .string({ required_error: 'price_id is required' })
  .trim()
  .min(1, 'price_id is required');
const url = (field: string) =>
  z
    .string({ required_error: `${field} is required` })
    .url(`${field} must be a valid URL`);

export const checkoutSchema = z
  .object({
    price_id: priceId,
    success_url: url('success_url'),
    cancel_url: url('cancel_url'),
  })
  .strip();
export type CheckoutBody = z.infer<typeof checkoutSchema>;

export const changePlanSchema = z.object({ price_id: priceId }).strip();
export type ChangePlanBody = z.infer<typeof changePlanSchema>;

// GET /portal takes its return URL from the query string.
export const portalQuerySchema = z
  .object({ return_url: url('return_url') })
  .strip();

// One purchasable plan in STRIPE_PLANS, as GET /billing/plans returns it.
// `amount` is in major units (4.99), as shown to the customer.
export const billingPlanSchema = z.object({
  price_id: z.string().min(1),
  plan_code: z.string().min(1),
  name: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z
    .string()
    .length(3)
    .transform((c) => c.toUpperCase()),
  interval: z.enum(['day', 'week', 'month', 'year']),
});
export type BillingPlan = z.infer<typeof billingPlanSchema>;

// One tip in STRIPE_TIPS, as GET /billing/tips returns it: a one-time price.
// `tip_code` matches the iOS tip jar (`kind`, `excellent`, `incredible`).
export const billingTipSchema = z.object({
  price_id: z.string().min(1),
  tip_code: z.string().min(1),
  name: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z
    .string()
    .length(3)
    .transform((c) => c.toUpperCase()),
});
export type BillingTip = z.infer<typeof billingTipSchema>;
