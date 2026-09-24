import { describe, it, expect } from '@jest/globals';
import { putItemSchema, updateItemSchema } from '../../validation/libraryItem';

/**
 * Both apps retry a failed sync job forever, so a schema that 422s a payload
 * they really send would wedge that user's sync permanently. These fixtures are
 * the exact shapes each app sends today — keep them in step with the clients:
 *
 * - iOS PUT /  → SyncJobScheduler.scheduleLibraryItemUploadJob (+ id/jobType
 *   the scheduler adds; `provider` is filtered out before sending)
 * - iOS POST / → UpdateTaskModel.toDictionaryPayload, and the synced:true
 *   confirmation in LibraryItemSyncOperation.markUploadAsSynced
 * - Android PUT /  → SyncTaskFactory.createUploadMetadataTask
 * - Android POST / → SyncTaskFactory.createUpdateTask (no relativePath) and
 *   createSyncSuccessTask; numbers arrive as doubles after the Gson round trip
 */
const uuid = '11111111-1111-4111-8111-111111111111';

const iosPut = {
  id: 'task-1',
  jobType: 'upload',
  uuid,
  relativePath: 'Folder/Book.m4b',
  originalFileName: 'Book.m4b',
  title: 'Book',
  details: 'Author',
  currentTime: 12.5,
  duration: 3600.25,
  percentCompleted: 0.35,
  isFinished: false,
  orderRank: 3,
  type: 2,
  lastPlayDateTimestamp: 1790204455,
  speed: 1.25,
};
const iosUpdate = {
  id: 'task-2',
  uuid,
  relativePath: 'Folder/Book.m4b',
  title: 'Book',
  details: 'Author',
  speed: 1.5,
  currentTime: 120.75,
  duration: 3600.25,
  percentCompleted: 3.35,
  isFinished: false,
  orderRank: 3,
  lastPlayDateTimestamp: 1790204455.123,
  type: 2,
};
const iosSyncedConfirmation = { uuid, relativePath: 'Folder/Book.m4b', synced: true };
const androidPut = {
  uuid,
  relativePath: 'Folder/Book.m4b',
  originalFileName: 'Book.m4b',
  title: 'Book',
  details: 'Author',
  duration: 3600,
  currentTime: 0,
  percentCompleted: 0,
  isFinished: false,
  orderRank: 0,
  lastPlayDateTimestamp: 1790204455,
  type: 2,
};
const androidUpdate = {
  uuid,
  title: 'Book',
  details: 'Author',
  duration: 3600.0,
  currentTime: 42.0,
  percentCompleted: 1.1666666666666667,
  isFinished: false,
  orderRank: 3.0,
  lastPlayDateTimestamp: 1.790204455e9,
  type: 2.0,
};
const androidSyncedConfirmation = { uuid, relativePath: 'Folder/Book.m4b', synced: true };

describe('putItemSchema (PUT /)', () => {
  it.each([
    ['iOS', iosPut],
    ['Android', androidPut],
  ])('accepts what %s sends', (_client, body) => {
    expect(putItemSchema.safeParse(body).success).toBe(true);
  });

  it('never lets a new row claim synced or a storage path: both are server-owned', () => {
    const parsed = putItemSchema.parse({ ...androidPut, synced: true, source_path: 'root/other.m4b' });

    expect(parsed).not.toHaveProperty('synced');
    expect(parsed).not.toHaveProperty('source_path');
  });

  it('requires relativePath, which putObject keys the row on', () => {
    const { relativePath: _omitted, ...withoutPath } = androidPut;
    expect(putItemSchema.safeParse(withoutPath).success).toBe(false);
  });
});

describe('updateItemSchema (POST /)', () => {
  it.each([
    ['iOS metadata update', iosUpdate],
    ['iOS synced confirmation', iosSyncedConfirmation],
    ['Android metadata update (no relativePath)', androidUpdate],
    ['Android synced confirmation', androidSyncedConfirmation],
  ])('accepts the %s', (_client, body) => {
    expect(updateItemSchema.safeParse(body).success).toBe(true);
  });

  it('keeps synced when it is a real boolean', () => {
    expect(updateItemSchema.parse(iosSyncedConfirmation).synced).toBe(true);
  });

  it('strips the storage path: a row must never point at another book\'s bytes', () => {
    const parsed = updateItemSchema.parse({ ...iosUpdate, source_path: 'root/other.m4b', sourcePath: 'x' });

    expect(parsed).not.toHaveProperty('source_path');
    expect(parsed).not.toHaveProperty('sourcePath');
  });

  it('drops keys the apps add for their own queue, like the task id', () => {
    expect(updateItemSchema.parse(iosUpdate)).not.toHaveProperty('id');
  });
});
