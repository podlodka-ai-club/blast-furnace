import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger, logger } from './logger.js';

describe('logger', () => {
  let consoleOutput: { method: string; args: string[] }[] = [];

  beforeEach(() => {
    consoleOutput = [];
    vi.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => {
      consoleOutput.push({ method: 'debug', args: args.map(String) });
    });
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      consoleOutput.push({ method: 'info', args: args.map(String) });
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      consoleOutput.push({ method: 'warn', args: args.map(String) });
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleOutput.push({ method: 'error', args: args.map(String) });
    });
  });

  describe('createLogger', () => {
    it('should create logger instance', () => {
      const testLogger = createLogger();
      expect(testLogger).toBeDefined();
      expect(typeof testLogger.debug).toBe('function');
      expect(typeof testLogger.info).toBe('function');
      expect(typeof testLogger.warn).toBe('function');
      expect(typeof testLogger.error).toBe('function');
    });

    it('should log debug messages', () => {
      const testLogger = createLogger();
      testLogger.debug('debug message');
      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0].method).toBe('debug');
      const entry = JSON.parse(consoleOutput[0].args[0]);
      expect(entry.level).toBe('debug');
      expect(entry.message).toBe('debug message');
    });

    it('should log info messages', () => {
      const testLogger = createLogger();
      testLogger.info('info message');
      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0].method).toBe('info');
      const entry = JSON.parse(consoleOutput[0].args[0]);
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('info message');
    });

    it('should log warn messages', () => {
      const testLogger = createLogger();
      testLogger.warn('warn message');
      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0].method).toBe('warn');
      const entry = JSON.parse(consoleOutput[0].args[0]);
      expect(entry.level).toBe('warn');
      expect(entry.message).toBe('warn message');
    });

    it('should log error messages', () => {
      const testLogger = createLogger();
      testLogger.error('error message');
      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0].method).toBe('error');
      const entry = JSON.parse(consoleOutput[0].args[0]);
      expect(entry.level).toBe('error');
      expect(entry.message).toBe('error message');
    });

    it('should include timestamp in log entry', () => {
      const testLogger = createLogger();
      testLogger.info('test message');
      const entry = JSON.parse(consoleOutput[0].args[0]);
      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('should include context when provided', () => {
      const testLogger = createLogger();
      testLogger.info('test message', { key: 'value', num: 42 });
      const entry = JSON.parse(consoleOutput[0].args[0]);
      expect(entry.context).toEqual({ key: 'value', num: 42 });
    });

    it('should handle undefined context', () => {
      const testLogger = createLogger();
      testLogger.info('test message');
      const entry = JSON.parse(consoleOutput[0].args[0]);
      expect(entry.context).toBeUndefined();
    });
  });

  describe('default logger', () => {
    it('should be exported as default instance', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });
  });
});
