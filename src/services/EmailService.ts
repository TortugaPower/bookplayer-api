import nodemailer from 'nodemailer';
import AWS from 'aws-sdk';
import { inject, injectable } from 'inversify';
import { TYPES } from '../ContainerTypes';
import { ILoggerService } from '../interfaces/ILoggerService';
import { EmailObj } from '../types/user';

@injectable()
export class EmailService {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  private client = nodemailer.createTransport({
    SES: {
      ses: new AWS.SES({ signatureVersion: 'v4', region: 'us-east-1' }),
      aws: AWS,
    },
  });

  async sendEmail(options: EmailObj): Promise<string> {
    try {
      const mailOptions = {
        from: `"${process.env.MAILER_NAME}" <${process.env.MAILER_EMAIL}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        attachments: options.attachments,
        bcc: options.bcc,
        cc: options.cc,
        // ses: {},
      };
      const emailId = await this.client.sendMail(mailOptions);
      return emailId.messageId;
    } catch (err) {
      this._logger.log(
        {
          origin: 'sendEmail',
          message: err.message,
          options,
        },
        'error',
      );
      return null;
    }
  }
}
