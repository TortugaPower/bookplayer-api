import { injectable } from 'inversify';
import winston from 'winston';

@injectable()
export class LoggerService {
  private formatter = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    }),
  );
  private logger = winston.createLogger({
    format: this.formatter,
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: 'error.log', level: 'error' }),
      new winston.transports.File({ filename: 'combined.log' }),
    ],
  });

  async log(message: unknown, level?: string): Promise<void> {
    this.logger.log({
      level: level || 'info',
      message: JSON.stringify(message),
    });
  }
}
