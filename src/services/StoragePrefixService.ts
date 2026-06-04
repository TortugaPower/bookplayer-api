import { User } from '../types/user';
import { logger } from './LoggerService';
import { UserDB } from './db/UserDB';
import { RedisService } from './RedisService';

type StoragePrefixConfig = {
  usesExternalId: boolean;
  externalId: string | null;
};

/**
 * Resolves the per-user S3 storage prefix.
 *
 * Historically the prefix was the auth token's email claim (`req.user.email`),
 * which for Apple "Hide My Email" users is a private-relay address that can
 * drift from the account's canonical identity. New accounts now store their
 * files under the stable `users.external_id`; the `storage_uses_external_id`
 * flag tells us which prefix a given user's objects actually live under.
 *
 * The flag is read-through cached (ValKey/Redis): read-heavy, written only at
 * account creation or during a deliberate per-user migration, so invalidate on
 * flip. On any cache/DB failure we fall back to the legacy email prefix so an
 * outage never makes a user's existing library unreachable.
 */
export class StoragePrefixService {
  private readonly _logger = logger;
  private static readonly CACHE_TTL_SECONDS = 3600;

  constructor(
    private _userDB: UserDB = new UserDB(),
    private _cache: RedisService = new RedisService(),
  ) {}

  /** Base prefix for a user's audio objects: `${prefix}/${source_path}`. */
  async getPrefix(user: User): Promise<string> {
    try {
      if (user?.id_user == null) return user?.email;
      const config = await this.getConfig(user.id_user, user.external_id);
      if (config.usesExternalId) {
        // external_id is provider-issued (Apple/Google sub, UUID, base64url) and
        // must be a single path segment. Guard against a missing id or a stray
        // '/' that would repartition the bucket; fall back to the legacy prefix.
        if (config.externalId && !config.externalId.includes('/')) {
          return config.externalId;
        }
        this._logger.log(
          {
            origin: 'StoragePrefixService.getPrefix',
            message:
              'storage_uses_external_id set but external_id is missing or invalid; using legacy email prefix',
            data: { id_user: user.id_user },
          },
          'error',
        );
      }
      return user.email;
    } catch (err) {
      this._logger.log(
        {
          origin: 'StoragePrefixService.getPrefix',
          message: err.message,
          data: { id_user: user?.id_user },
        },
        'error',
      );
      // Fail safe: legacy behaviour keeps existing libraries reachable.
      return user?.email;
    }
  }

  /** Invalidate the cached config after flipping a user's flag. */
  async invalidate(user_id: number): Promise<void> {
    await this._cache.deleteObject(this.cacheKey(user_id));
  }

  private cacheKey(user_id: number): string {
    return `storage_prefix_cfg_${user_id}`;
  }

  private async getConfig(
    user_id: number,
    fallbackExternalId?: string,
  ): Promise<StoragePrefixConfig> {
    const cached = (await this._cache.getObject(
      this.cacheKey(user_id),
    )) as StoragePrefixConfig | null;
    if (cached) return cached;

    const row = await this._userDB.getStorageConfig(user_id);
    const config: StoragePrefixConfig = {
      usesExternalId: !!row?.storage_uses_external_id,
      externalId: row?.external_id || fallbackExternalId || null,
    };
    await this._cache.setObject(
      this.cacheKey(user_id),
      config,
      StoragePrefixService.CACHE_TTL_SECONDS,
    );
    return config;
  }
}
