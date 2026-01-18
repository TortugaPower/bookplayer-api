import { injectable } from 'inversify';
import winston from 'winston';

@injectable()
export class LoggerService {
  private logger: winston.Logger;

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';

    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || (isProduction ? 'warn' : 'info'),
      format: isProduction
        ? winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        : winston.format.combine(
            winston.format.timestamp(),
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp }) => {
              return `${timestamp} ${level}: ${message}`;
            })
          ),
      transports: [
        new winston.transports.Console(),
        ...(isProduction
          ? []
          : [
              new winston.transports.File({ filename: 'error.log', level: 'error' }),
              new winston.transports.File({ filename: 'combined.log' }),
            ]),
      ],
    });
  }

  async log(message: unknown, level?: string): Promise<void> {
    const logLevel = level || 'info';

    if (typeof message === 'object' && message !== null) {
      this.logger.log({
        level: logLevel,
        ...message as object,
      });
    } else {
      this.logger.log({
        level: logLevel,
        message: String(message),
      });
    }
  }
}
