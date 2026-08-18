/**
 * Structured logging utility
 * Replaces console.log with environment-aware logging
 * Prevents sensitive data logging in production
 */


interface LogContext {
  [key: string]: any;
}

class Logger {
  private isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';

  /**
   * Debug-level logging (only in development)
   * Use for detailed debugging information
   */
  debug(message: string, context?: LogContext): void {
    if (this.isDevelopment) {
      console.debug(`[DEBUG] ${message}`, context ? this.sanitize(context) : '');
    }
  }

  /**
   * Info-level logging
   * Use for general informational messages
   */
  info(message: string, context?: LogContext): void {
    console.info(`[INFO] ${message}`, context ? this.sanitize(context) : '');
  }

  /**
   * Warning-level logging
   * Use for non-critical issues
   */
  warn(message: string, error?: Error | unknown): void {
    console.warn(`[WARN] ${message}`, error instanceof Error ? error.message : String(error));
  }

  /**
   * Error-level logging
   * Use for errors that need attention
   */
  error(message: string, error: Error | unknown): void {
    if (error instanceof Error) {
      console.error(`[ERROR] ${message}`, {
        message: error.message,
        stack: this.isDevelopment ? error.stack : undefined
      });
    } else {
      console.error(`[ERROR] ${message}`, String(error));
    }
  }

  /**
   * Sanitize context to remove sensitive data
   */
  private sanitize(context: LogContext): LogContext {
    const sensitiveKeys = ['password', 'token', 'fcmToken', 'apiKey', 'secret', 'email', 'phone'];
    const sanitized: LogContext = {};

    for (const [key, value] of Object.entries(context)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

export const logger = new Logger();
