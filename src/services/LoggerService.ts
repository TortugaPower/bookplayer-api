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
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
              const metaStr = Object.keys(meta).length > 0
                ? ` ${JSON.stringify(meta)}`
                : '';
              return `${timestamp} ${level}: ${message}${metaStr}`;
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

  // Sanitize and extract useful info from objects for logging
  private sanitizeData(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data !== 'object') {
      return data;
    }

    try {
      const obj = data as Record<string, unknown>;
      const sanitized: Record<string, unknown> = {};

      for (const key of Object.keys(obj)) {
        const value = obj[key];

        // Skip sensitive fields
        if (['password', 'token', 'secret', 'authorization'].includes(key.toLowerCase())) {
          sanitized[key] = '[REDACTED]';
          continue;
        }

        // Extract useful info from user object
        if (key === 'user' && typeof value === 'object' && value !== null) {
          const user = value as Record<string, unknown>;
          sanitized['userId'] = user.id_user;
          sanitized['userEmail'] = user.email;
          continue;
        }

        // Extract useful info from request body
        if (key === 'body' && typeof value === 'object' && value !== null) {
          sanitized['requestBody'] = this.sanitizeData(value);
          continue;
        }

        // Extract useful info from request query
        if (key === 'query' && typeof value === 'object' && value !== null) {
          sanitized['requestQuery'] = this.sanitizeData(value);
          continue;
        }

        // Extract useful info from request params
        if (key === 'params' && typeof value === 'object' && value !== null) {
          sanitized['requestParams'] = this.sanitizeData(value);
          continue;
        }

        // Handle nested objects (but avoid circular refs)
        if (typeof value === 'object' && value !== null) {
          try {
            sanitized[key] = JSON.parse(JSON.stringify(value));
          } catch {
            sanitized[key] = '[Circular or non-serializable]';
          }
        } else {
          sanitized[key] = value;
        }
      }

      return sanitized;
    } catch {
      return '[Error sanitizing data]';
    }
  }

  async log(message: unknown, level?: string): Promise<void> {
    const logLevel = level || 'info';

    if (typeof message === 'object' && message !== null) {
      const msgObj = message as Record<string, unknown>;

      // Sanitize the data field if present
      const logData: Record<string, unknown> = {
        level: logLevel,
        message: msgObj.message ? String(msgObj.message) : JSON.stringify(message),
      };

      // Copy other fields
      for (const key of Object.keys(msgObj)) {
        if (key === 'message') continue;

        if (key === 'data') {
          const sanitized = this.sanitizeData(msgObj.data);
          if (sanitized && typeof sanitized === 'object') {
            Object.assign(logData, sanitized);
          }
        } else {
          logData[key] = msgObj[key];
        }
      }

      this.logger.log(logData as winston.LogEntry);
    } else {
      this.logger.log({
        level: logLevel,
        message: String(message),
      });
    }
  }
}
