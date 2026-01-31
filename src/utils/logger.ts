import pino from 'pino';

const pinoFactory = (pino as any).default || pino;

const baseLogger = pinoFactory({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: {
    target: 'pino-pretty',
    options: { colorize: false, singleLine: true },
  },
});

// Keep a thin wrapper so existing call sites don't need to change
export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => baseLogger.info(meta || {}, message),
  error: (message: string, meta?: Record<string, unknown>) => baseLogger.error(meta || {}, message),
  warn: (message: string, meta?: Record<string, unknown>) => baseLogger.warn(meta || {}, message),
  debug: (message: string, meta?: Record<string, unknown>) => baseLogger.debug(meta || {}, message),
};

