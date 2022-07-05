/* eslint-disable @typescript-eslint/no-explicit-any */
import { RestClientProps } from '../types/user';

export interface IRestClientService {
  setupClient(): void;
  callService(req: RestClientProps): Promise<any>;
}
