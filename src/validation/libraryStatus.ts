import { z } from 'zod';

// Request body for POST /status: every uuid in the client's local library.
// Entries only have to be strings. One malformed local uuid must not fail the
// whole request (the pass would then fail every week); LibraryService leaves
// anything that isn't a uuid out of the answer instead.
export const libraryStatusSchema = z
  .object({
    uuids: z.array(z.string(), {
      required_error: 'uuids is required',
      invalid_type_error: 'uuids must be an array of strings',
    }),
  })
  .strip();

// Declared explicitly for the same reason as multipartUpload.ts: no
// strictNullChecks, so z.infer is too loose to trust.
export type LibraryStatusBody = { uuids: string[] };
