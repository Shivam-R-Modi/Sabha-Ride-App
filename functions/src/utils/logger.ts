/**
 * Cloud Functions structured logging utility
 * Replaces console.log with Firebase-compatible logging
 * Integrates with Cloud Logging for production monitoring
 */

import { logger as functionsLogger } from 'firebase-functions';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: any;
}

class CloudLogger {
  /**
   * Debug-level logging (only in development/testing)
   */
  debug(message: string, context?: LogContext): void {
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      functionsLogger.debug(message, this.sanitize(context || {}));
    }
  }

  /**
   * Info-level logging
   */
  info(message: string, context?: LogContext): void {
    functionsLogger.info(message, this.sanitize(context || {}));
  }

  /**
   * Warning-level logging
   */
  warn(message: string, error?: Error | unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error);
    functionsLogger.warn(message, { error: errorMsg });
  }

  /**
   * Error-level logging
   */
  error(message: string, error: Error | unknown): void {
    if (error instanceof Error) {
      functionsLogger.error(message, {
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      });
    } else {
      functionsLogger.error(message, { error: String(error) });
    }
  }

  /**
   * Sanitize context to remove sensitive data
   */
  private sanitize(context: LogContext): LogContext {
    const sensitiveKeys = ['password', 'token', 'fcmToken', 'apiKey', 'secret', 'email', 'phone', 'uid'];
    const sanitized: LogContext = {};

    for (const [key, value] of Object.entries(context)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (Array.isArray(value)) {
        // Sanitize arrays (don't log full student/user arrays)
        sanitized[key] = `[Array of ${value.length} items]`;
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

export const logger = new CloudLogger();
