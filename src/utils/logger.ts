// Structured logging utility

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

function formatLogEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  };
}

function logToConsole(entry: LogEntry): void {
  const formatted = JSON.stringify(entry);
  switch (entry.level) {
    case 'debug':
      console.debug(formatted);
      break;
    case 'info':
      console.info(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    case 'error':
      console.error(formatted);
      break;
  }
}

function mergeContext(defaultContext?: Record<string, unknown>, context?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!defaultContext && !context) return undefined;
  return { ...defaultContext, ...context };
}

export function createLogger(defaultContext?: Record<string, unknown>): Logger {
  return {
    debug(message: string, context?: Record<string, unknown>): void {
      const entry = formatLogEntry('debug', message, mergeContext(defaultContext, context));
      logToConsole(entry);
    },
    info(message: string, context?: Record<string, unknown>): void {
      const entry = formatLogEntry('info', message, mergeContext(defaultContext, context));
      logToConsole(entry);
    },
    warn(message: string, context?: Record<string, unknown>): void {
      const entry = formatLogEntry('warn', message, mergeContext(defaultContext, context));
      logToConsole(entry);
    },
    error(message: string, context?: Record<string, unknown>): void {
      const entry = formatLogEntry('error', message, mergeContext(defaultContext, context));
      logToConsole(entry);
    },
  };
}

// Default logger instance
export const logger = createLogger();
