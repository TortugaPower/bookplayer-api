import { describe, it, expect, beforeEach } from '@jest/globals';
import { randomUUID } from 'crypto';
import { SubscriptionDB } from '../../services/db/SubscriptionDB';
import { RevenuecatEvent } from '../../types/user';
import { getTestTransaction, mockLoggerService } from '../setup';

describe('SubscriptionDB.getLatestActiveEvent', () => {
  let db: SubscriptionDB;
  let now: number;

  beforeEach(() => {
    db = new SubscriptionDB();
    (db as any).db = getTestTransaction();
    (db as any)._logger = mockLoggerService;
    mockLoggerService.log.mockClear();
    now = Date.now();
  });

  // Shaped like RevenueCat's webhook events; `fields` overrides any key, and a
  // key set to undefined is left out of the stored JSON.
  const event = (
    appUserId: string,
    fields: Record<string, unknown>,
  ): RevenuecatEvent =>
    ({
      id: randomUUID(),
      type: 'RENEWAL',
      app_user_id: appUserId,
      original_app_user_id: appUserId,
      aliases: [appUserId],
      entitlement_ids: ['pro'],
      expiration_at_ms: now + 86400000,
      event_timestamp_ms: now,
      environment: 'SANDBOX',
      ...fields,
    } as unknown as RevenuecatEvent);

  it('answers when a Web Billing event with null aliases is stored', async () => {
    const user = randomUUID();
    await db.insertSubscriptionEvent(event(user, {}));
    await db.insertSubscriptionEvent(
      event(randomUUID(), {
        type: 'INVOICE_ISSUANCE',
        aliases: null,
        entitlement_ids: null,
        expiration_at_ms: null,
      }),
    );

    const latest = await db.getLatestActiveEvent(user);

    expect(mockLoggerService.log).not.toHaveBeenCalled();
    expect(latest?.type).toBe('RENEWAL');
    expect(latest?.entitlement_ids).toEqual(['pro']);
  });

  it('finds an event through its aliases', async () => {
    const user = randomUUID();
    // RevenueCat's shape: 32 hex characters, fitting original_app_user_id's 50.
    const anonymous = `$RCAnonymousID:${randomUUID().replace(/-/g, '')}`;
    await db.insertSubscriptionEvent(
      event(anonymous, { aliases: [anonymous, user] }),
    );

    const latest = await db.getLatestActiveEvent(user);

    expect(latest?.type).toBe('RENEWAL');
  });

  it('skips newer events that do not describe a subscription', async () => {
    const user = randomUUID();
    await db.insertSubscriptionEvent(
      event(user, { expiration_at_ms: now + 3600000 }),
    );
    await db.insertSubscriptionEvent(
      event(user, {
        type: 'INVOICE_ISSUANCE',
        aliases: null,
        entitlement_ids: null,
        expiration_at_ms: null,
        event_timestamp_ms: now + 1000,
      }),
    );
    await db.insertSubscriptionEvent(
      event(user, {
        type: 'TRANSFER',
        aliases: undefined,
        entitlement_ids: [],
        expiration_at_ms: null,
        event_timestamp_ms: now + 2000,
      }),
    );

    const latest = await db.getLatestActiveEvent(user);

    expect(latest?.type).toBe('RENEWAL');
    expect(Number(latest?.expiration_at_ms)).toBe(now + 3600000);
  });

  it('still returns an expiration as the latest event', async () => {
    const user = randomUUID();
    await db.insertSubscriptionEvent(event(user, {}));
    await db.insertSubscriptionEvent(
      event(user, {
        type: 'EXPIRATION',
        expiration_at_ms: now,
        event_timestamp_ms: now + 1000,
      }),
    );

    const latest = await db.getLatestActiveEvent(user);

    expect(latest?.type).toBe('EXPIRATION');
  });

  it('is null for an account with no events', async () => {
    expect(await db.getLatestActiveEvent(randomUUID())).toBeNull();
    expect(mockLoggerService.log).not.toHaveBeenCalled();
  });
});
