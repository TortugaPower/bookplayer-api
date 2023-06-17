export interface ILoggerService {
  log(m: unknown, l?: string): Promise<void>;
}
