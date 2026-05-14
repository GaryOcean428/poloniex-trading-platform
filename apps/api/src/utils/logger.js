import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keys to exclude from metadata logging
const EXCLUDED_METADATA_KEYS = ['level', 'message', 'timestamp'];

// A logger must never throw on its caller. Axios errors carry
// .request → .socket (a circular TLSSocket); winston spreads an
// error's own-properties into metadata, so a raw
// `logger.error(msg, axiosErr)` would make JSON.stringify throw
// "Converting circular structure to JSON" — and that throw replaces
// the original error, turning a recoverable 429 into a failed tick.
const safeStringify = (obj) => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
};

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...metadata }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;

    // Add metadata if present (for structured logging)
    const metadataKeys = Object.keys(metadata);
    if (metadataKeys.length > 0 && metadataKeys.some(key => !EXCLUDED_METADATA_KEYS.includes(key))) {
      const cleanMetadata = Object.fromEntries(
        Object.entries(metadata).filter(([key]) => !EXCLUDED_METADATA_KEYS.includes(key))
      );
      if (Object.keys(cleanMetadata).length > 0) {
        logMessage += ` ${safeStringify(cleanMetadata)}`;
      }
    }

    return logMessage;
  })
);

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Create logs directory if it doesn't exist
import { mkdirSync } from 'fs';
try {
  mkdirSync(path.join(__dirname, '../../logs'), { recursive: true });
} catch (error) {
  // Directory already exists
}

export { logger };
export default logger;
