"use strict";
/**
 * Cloud Functions structured logging utility
 * Replaces console.log with Firebase-compatible logging
 * Integrates with Cloud Logging for production monitoring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const firebase_functions_1 = require("firebase-functions");
class CloudLogger {
    /**
     * Debug-level logging (only in development/testing)
     */
    debug(message, context) {
        if (process.env.FUNCTIONS_EMULATOR === 'true') {
            firebase_functions_1.logger.debug(message, this.sanitize(context || {}));
        }
    }
    /**
     * Info-level logging
     */
    info(message, context) {
        firebase_functions_1.logger.info(message, this.sanitize(context || {}));
    }
    /**
     * Warning-level logging
     */
    warn(message, error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        firebase_functions_1.logger.warn(message, { error: errorMsg });
    }
    /**
     * Error-level logging
     */
    error(message, error) {
        if (error instanceof Error) {
            firebase_functions_1.logger.error(message, {
                message: error.message,
                stack: error.stack,
                code: error.code
            });
        }
        else {
            firebase_functions_1.logger.error(message, { error: String(error) });
        }
    }
    /**
     * Sanitize context to remove sensitive data
     */
    sanitize(context) {
        const sensitiveKeys = ['password', 'token', 'fcmToken', 'apiKey', 'secret', 'email', 'phone', 'uid'];
        const sanitized = {};
        for (const [key, value] of Object.entries(context)) {
            if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
                sanitized[key] = '[REDACTED]';
            }
            else if (Array.isArray(value)) {
                // Sanitize arrays (don't log full student/user arrays)
                sanitized[key] = `[Array of ${value.length} items]`;
            }
            else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitize(value);
            }
            else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
}
exports.logger = new CloudLogger();
//# sourceMappingURL=logger.js.map