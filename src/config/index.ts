import type { AppConfig } from '../types/index.js';

function parsePort(value: string | undefined, defaultVal: number): number {
  const parsed = parseInt(value ?? String(defaultVal), 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    return defaultVal;
  }
  return parsed;
}

function parsePollInterval(value: string | undefined, defaultVal: number): number {
  const parsed = parseInt(value ?? String(defaultVal), 10);
  if (Number.isNaN(parsed) || parsed < 1000) {
    return defaultVal;
  }
  return parsed;
}

function parseTimeout(value: string | undefined, defaultVal: number): number {
  const parsed = parseInt(value ?? String(defaultVal), 10);
  const maxTimeout = 600000; // 10 minutes max
  if (Number.isNaN(parsed) || parsed < 1 || parsed > maxTimeout) {
    return defaultVal;
  }
  return parsed;
}

function parseMinimumTimeout(value: string | undefined, defaultVal: number): number {
  const parsed = parseInt(value ?? String(defaultVal), 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return defaultVal;
  }
  return parsed;
}

function parseReviewAttemptLimit(value: string | undefined, defaultVal: number): number {
  if (value === undefined) return defaultVal;
  if (!/^\d+$/.test(value)) {
    throw new Error('REVIEW_ATTEMPT_LIMIT must be an integer from 1 through 19');
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 19) {
    throw new Error('REVIEW_ATTEMPT_LIMIT must be an integer from 1 through 19');
  }
  return parsed;
}

function parseMaxHumanReworkAttempts(value: string | undefined, defaultVal: number): number {
  if (value === undefined) return defaultVal;
  if (!/^\d+$/.test(value)) {
    throw new Error('MAX_HUMAN_REWORK_ATTEMPTS must be an integer from 1 through 19');
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 19) {
    throw new Error('MAX_HUMAN_REWORK_ATTEMPTS must be an integer from 1 through 19');
  }
  return parsed;
}

function loadConfig(): AppConfig {
  return {
    env: process.env['NODE_ENV'] ?? 'development',
    port: parsePort(process.env['PORT'], 3000),
    redis: {
      host: process.env['REDIS_HOST'] ?? 'localhost',
      port: parsePort(process.env['REDIS_PORT'], 6379),
      password: process.env['REDIS_PASSWORD'] ?? undefined,
    },
    github: {
      token: process.env['GITHUB_TOKEN'] ?? '',
      owner: process.env['GITHUB_OWNER'] ?? '',
      repo: process.env['GITHUB_REPO'] ?? '',
      pollIntervalMs: parsePollInterval(process.env['GITHUB_POLL_INTERVAL_MS'], 60000),
    },
    codex: {
      cliPath: process.env['CODEX_CLI_PATH'] ?? 'npx @openai/codex',
      model: process.env['CODEX_MODEL'] ?? 'gpt-5.4',
      timeoutMs: parseTimeout(process.env['CODEX_TIMEOUT_MS'], 300000),
    },
    qualityGate: {
      testCommand: process.env['QUALITY_GATE_TEST_COMMAND']?.trim() || undefined,
      testTimeoutMs: parseMinimumTimeout(process.env['QUALITY_GATE_TEST_TIMEOUT_MS'], 180000),
    },
    review: {
      attemptLimit: parseReviewAttemptLimit(process.env['REVIEW_ATTEMPT_LIMIT'], 3),
    },
    rework: {
      maxHumanReworkAttempts: parseMaxHumanReworkAttempts(process.env['MAX_HUMAN_REWORK_ATTEMPTS'], 3),
    },
  };
}

export const config = loadConfig();
