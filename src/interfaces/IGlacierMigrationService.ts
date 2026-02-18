export interface IGlacierMigrationService {
  HandleExpirationEvent(
    userId: number,
    email: string,
    externalId: string,
  ): Promise<void>;
}
