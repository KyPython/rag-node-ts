/**
 * Simple structured JSON logger
 * Logs JSON lines with timestamp, level, message, and optional metadata
 */

export type LogLevel = 'info' | 'error' | 'warn' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

/**
 * Logs a structured JSON entry to stdout/stderr
 * Automatically includes requestId from meta if present
 */
function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta && { meta }),
  };

  const output = JSON.stringify(entry);
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(output + '\n');
}

/**
 * Helper to create log metadata with requestId
 */
export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};

