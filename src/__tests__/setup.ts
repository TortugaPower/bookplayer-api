import { Knex } from 'knex';
import { randomUUID } from 'crypto';
import database from '../database';
import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  jest,
} from '@jest/globals';

// Global database instance for tests
let db: Knex;

// Store transaction for each test
let testTransaction: Knex.Transaction | null = null;

beforeAll(async () => {
  // Initialize database connection
  db = database;

  // Ensure we're not running against production
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot run tests in production environment!');
  }
});

beforeEach(async () => {
  // Start a transaction for each test
  testTransaction = await db.transaction();
});

afterEach(async () => {
  // Rollback transaction after each test - all changes are discarded
  if (testTransaction) {
    await testTransaction.rollback();
    testTransaction = null;
  }
});

afterAll(async () => {
  // Close database connection
  await db.destroy();
});

// Helper to get the test transaction
export function getTestTransaction(): Knex.Transaction {
  if (!testTransaction) {
    throw new Error('No test transaction available. Are you inside a test?');
  }
  return testTransaction;
}

// Helper to get database instance
export function getDb(): Knex {
  return db;
}

// Mock for email service
export const mockEmailService = {
  sendEmail: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
};

// Mock for logger service
export const mockLoggerService = {
  log: jest.fn<() => void>(),
};

// Mock for user service
export const mockUserService = {
  getUser: jest.fn<() => Promise<any>>().mockResolvedValue(null),
  addNewUser: jest.fn<() => Promise<any>>(),
};

// Helper to create test users
export async function createTestUser(
  trx: Knex.Transaction,
  overrides: Partial<{
    email: string;
    active: boolean;
    external_id: string;
  }> = {},
): Promise<{ id_user: number; email: string; external_id: string }> {
  const email = overrides.email || `test-${Date.now()}@example.com`;
  const external_id = overrides.external_id || randomUUID();
  const [user] = await trx('users')
    .insert({
      email,
      password: '',
      external_id,
      active: overrides.active ?? true,
    })
    .returning(['id_user', 'email', 'external_id']);

  return user;
}

// Helper to create test auth method
export async function createTestAuthMethod(
  trx: Knex.Transaction,
  params: {
    user_id: number;
    auth_type: string;
    external_id: string;
    is_primary?: boolean;
  },
): Promise<{ id_auth_method: number }> {
  const [authMethod] = await trx('auth_methods')
    .insert({
      user_id: params.user_id,
      auth_type: params.auth_type,
      external_id: params.external_id,
      is_primary: params.is_primary ?? false,
    })
    .returning('id_auth_method');

  return authMethod;
}

// Helper to create test verification code
export async function createTestVerificationCode(
  trx: Knex.Transaction,
  params: {
    email: string;
    code: string;
    expires_at: Date;
    verified?: boolean;
    attempts?: number;
  },
): Promise<{ id: number }> {
  const [record] = await trx('email_verification_codes')
    .insert({
      email: params.email.toLowerCase(),
      code: params.code,
      expires_at: params.expires_at,
      verified: params.verified ?? false,
      attempts: params.attempts ?? 0,
    })
    .returning('id');

  return record;
}

// Helper to create test challenge
export async function createTestChallenge(
  trx: Knex.Transaction,
  params: {
    challenge: Buffer;
    email?: string;
    user_id?: number;
    challenge_type: 'registration' | 'authentication';
    expires_at: Date;
  },
): Promise<{ id_challenge: number }> {
  const [record] = await trx('webauthn_challenges')
    .insert({
      challenge: params.challenge,
      email: params.email,
      user_id: params.user_id,
      challenge_type: params.challenge_type,
      expires_at: params.expires_at,
    })
    .returning('id_challenge');

  return record;
}

// Helper to create test passkey credential
export async function createTestPasskeyCredential(
  trx: Knex.Transaction,
  params: {
    auth_method_id: number;
    credential_id: Buffer;
    public_key: Buffer;
    counter?: number;
    device_type?: string;
    backed_up?: boolean;
    transports?: string[];
    device_name?: string;
    active?: boolean;
  },
): Promise<{ id_passkey: number }> {
  const [record] = await trx('passkey_credentials')
    .insert({
      auth_method_id: params.auth_method_id,
      credential_id: params.credential_id,
      public_key: params.public_key,
      counter: params.counter ?? 0,
      device_type: params.device_type ?? 'multiDevice',
      backed_up: params.backed_up ?? true,
      transports: params.transports ?? ['internal'],
      device_name: params.device_name,
      active: params.active ?? true,
    })
    .returning('id_passkey');

  return record;
}

// Helper to create test subscription_events rows
export async function createTestSubscriptionEvent(
  trx: Knex.Transaction,
  params: {
    original_app_user_id: string;
    type: string;
    expiration_at_ms: number;
    event_timestamp_ms?: number;
    period_type?: string;
    aliases?: string[];
    app_user_id?: string;
  },
): Promise<{ id_subscription_event: number }> {
  const eventTs = params.event_timestamp_ms ?? Date.now();
  const json = {
    aliases: params.aliases,
    app_user_id: params.app_user_id ?? params.original_app_user_id,
    event_timestamp_ms: eventTs,
    expiration_at_ms: params.expiration_at_ms,
    original_app_user_id: params.original_app_user_id,
    period_type: params.period_type ?? 'NORMAL',
    type: params.type,
  };
  const [record] = await trx('subscription_events')
    .insert({
      id: randomUUID(),
      original_app_user_id: params.original_app_user_id,
      type: params.type,
      period_type: params.period_type ?? 'NORMAL',
      expiration_at_ms: String(params.expiration_at_ms),
      json: JSON.stringify(json),
    })
    .returning('id_subscription_event');

  return record;
}
