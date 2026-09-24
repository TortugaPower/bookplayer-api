import { z } from 'zod';

// Request-body schemas for PUT / (upload a book's metadata) and POST / (update
// it). Both apps retry a failed sync job forever, so a 422 here on a real
// payload would wedge that user's sync: the types follow exactly what iOS and
// Android send (see src/__tests__/validation/libraryItem.test.ts), and every
// metadata field stays optional. Unlisted keys are stripped, so a client can't
// write server-owned columns — `source_path`, and `synced` on PUT.

// Not `.uuid()`: iOS can still send a placeholder before an item's real uuid
// is matched.
const uuid = z.string();
// Numbers stay unconstrained to integers: iOS sends fractional timestamps, and
// Android's Gson round trip turns every number into a double.
const number = z.number().optional();

const metadata = {
  uuid: uuid.optional(),
  originalFileName: z.string().optional(),
  title: z.string().optional(),
  details: z.string().optional(),
  speed: number,
  currentTime: number,
  duration: number,
  percentCompleted: number,
  isFinished: z.boolean().optional(),
  orderRank: number,
  lastPlayDateTimestamp: number,
  type: number,
};

export const putItemSchema = z
  .object({
    ...metadata,
    relativePath: z.string({ required_error: 'relativePath is required' }),
  })
  .strip();

export const updateItemSchema = z
  .object({
    ...metadata,
    // Android names the item by uuid alone on metadata updates.
    relativePath: z.string().optional(),
    synced: z.boolean().optional(),
  })
  .strip();
