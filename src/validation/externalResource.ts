import { z } from 'zod';

// Request-body schemas for the external-resource endpoints. First adopter of
// zod in this codebase — validation elsewhere is still manual (see CLAUDE.md);
// adopt incrementally per endpoint rather than all at once.

const uuid = z
  .string({ required_error: 'A valid item uuid is required' })
  .uuid('A valid item uuid is required');
const requiredString = (field: string) =>
  z.string({ required_error: `${field} is required` })
    .trim()
    .min(1, `${field} is required`);

// PUT /external — create/register an external resource for a library item.
export const putExternalResourceSchema = z
  .object({
    uuid,
    providerName: requiredString('providerName'),
    providerId: requiredString('providerId'),
    syncStatus: requiredString('syncStatus'),
    // Accept an ISO string or Date; absent/null → null.
    lastSyncedAt: z.coerce.date().nullish().transform((v) => v ?? null),
    processedFile: z.boolean().optional().default(false),
    hostId: z.string().nullish().transform((v) => v ?? null),
  })
  .strip();

// DELETE /external — soft-delete a resource by (uuid, provider).
export const deleteExternalResourceSchema = z
  .object({
    uuid,
    providerName: requiredString('providerName'),
    providerId: requiredString('providerId'),
  })
  .strip();

// POST /external_set — request a presigned PUT URL, or confirm an upload.
export const itemPutRequestSchema = z
  .object({
    uuid,
    uploaded: z.boolean().optional(),
  })
  .strip();

// Validated output shapes. Declared explicitly (not via z.infer) because this
// project's tsconfig lacks strictNullChecks — see validate.ts. Controllers cast
// the validated req.body to these.
export type PutExternalResourceBody = {
  uuid: string;
  providerName: string;
  providerId: string;
  syncStatus: string;
  lastSyncedAt: Date | null;
  processedFile: boolean;
  hostId: string | null;
};

export type DeleteExternalResourceBody = {
  uuid: string;
  providerName: string;
  providerId: string;
};

export type ItemPutRequestBody = {
  uuid: string;
  uploaded?: boolean;
};
