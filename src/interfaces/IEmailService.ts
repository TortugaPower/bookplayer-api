import { EmailObj } from '../types/user';

export interface IEmailService {
  sendEmail(options: EmailObj): Promise<string>;
}
