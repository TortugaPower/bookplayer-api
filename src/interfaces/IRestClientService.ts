import { RestClientProps } from "../types/user";

export interface IRestClientService {
  setupClient(): void;
  callService(req: RestClientProps): Promise<any>;
}