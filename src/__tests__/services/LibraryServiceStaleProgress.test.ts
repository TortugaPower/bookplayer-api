import { describe, it, expect, beforeEach } from '@jest/globals';
import { LibraryService } from '../../services/LibraryService';
import { getTestTransaction, mockLoggerService, createTestUser, createTestLibraryItem } from '../setup';

/**
 * Apps queue progress updates and can send them late: a browser tab closed
 * before its queue drained, a phone back online. Each update says when it was
 * played, so one older than the play the server already has must not
 * overwrite that newer play from another device.
 */
describe('LibraryService.updateObject — progress played before the stored play', () => {
  let service: LibraryService;

  beforeEach(() => {
    service = new LibraryService();
    (service as any).db = getTestTransaction();
    (service as any)._libraryDB.db = getTestTransaction();
    (service as any)._libraryDB._logger = mockLoggerService;
    (service as any)._logger = mockLoggerService;
  });

  /** A book another device last played at second 1000, at 115 s, not finished. */
  const setup = async (stored: { last_play_date?: number | null; is_finish?: boolean } = {}) => {
    const trx = getTestTransaction();
    const user = await createTestUser(trx);
    const item = await createTestLibraryItem(trx, { user_id: user.id_user, key: 'Book.m4b' });
    await trx('library_items')
      .where({ id_library_item: item.id_library_item })
      .update({
        actual_time: '115',
        percent_completed: 48,
        is_finish: stored.is_finish ?? false,
        last_play_date: stored.last_play_date === undefined ? 1000 : stored.last_play_date,
      });
    const row = async () =>
      trx('library_items').where({ id_library_item: item.id_library_item }).first();
    return { user, item, row };
  };

  const progress = (currentTime: number, playedAt: number) => ({
    currentTime,
    percentCompleted: Math.round((currentTime / 240) * 100),
    isFinished: false,
    lastPlayDateTimestamp: playedAt,
  });

  it('keeps the newer play when an older update arrives late, and still answers success', async () => {
    const { user, item, row } = await setup();

    const result = await service.updateObject(user as any, 'Book.m4b', progress(51, 900) as any, item.uuid!);

    expect(result).toBe(true);
    const r = await row();
    expect(r.actual_time).toBe('115');
    expect(r.percent_completed).toBe(48);
    expect(r.last_play_date).toBe(1000);
  });

  it('applies an update played after the stored play', async () => {
    const { user, item, row } = await setup();

    await service.updateObject(user as any, 'Book.m4b', progress(130, 1100) as any, item.uuid!);

    const r = await row();
    expect(r.actual_time).toBe('130');
    expect(r.last_play_date).toBe(1100);
  });

  it('applies one played in the same second: only a strictly older play is held back', async () => {
    const { user, item, row } = await setup();

    await service.updateObject(user as any, 'Book.m4b', progress(120, 1000) as any, item.uuid!);

    expect((await row()).actual_time).toBe('120');
  });

  it('keeps the rest of an older update, such as a new title', async () => {
    const { user, item, row } = await setup();

    await service.updateObject(
      user as any,
      'Book.m4b',
      { ...progress(51, 900), title: 'Renamed' } as any,
      item.uuid!,
    );

    const r = await row();
    expect(r.title).toBe('Renamed');
    expect(r.actual_time).toBe('115');
  });

  it("doesn't let an older update un-finish a book finished in a later play", async () => {
    const { user, item, row } = await setup({ is_finish: true });

    await service.updateObject(user as any, 'Book.m4b', progress(51, 900) as any, item.uuid!);

    expect((await row()).is_finish).toBe(true);
  });

  it('always applies an update without a play time, such as mark as finished', async () => {
    const { user, item, row } = await setup();

    await service.updateObject(user as any, 'Book.m4b', { isFinished: true } as any, item.uuid!);

    expect((await row()).is_finish).toBe(true);
  });

  it('applies the first play of a book the server never saw played', async () => {
    const { user, item, row } = await setup({ last_play_date: null });

    await service.updateObject(user as any, 'Book.m4b', progress(51, 900) as any, item.uuid!);

    const r = await row();
    expect(r.actual_time).toBe('51');
    expect(r.last_play_date).toBe(900);
  });

  it('applies an update when the stored play is from the future, from a device whose clock is ahead', async () => {
    const tomorrow = Math.floor(Date.now() / 1000) + 86_400;
    const { user, item, row } = await setup({ last_play_date: tomorrow });
    const now = Math.floor(Date.now() / 1000);

    await service.updateObject(user as any, 'Book.m4b', progress(130, now) as any, item.uuid!);

    const r = await row();
    expect(r.actual_time).toBe('130');
    expect(r.last_play_date).toBe(now);
  });

  it('checks by path too, for clients that send no uuid', async () => {
    const { user, row } = await setup();

    await service.updateObject(user as any, 'Book.m4b', progress(51, 900) as any);

    expect((await row()).actual_time).toBe('115');
  });
});
