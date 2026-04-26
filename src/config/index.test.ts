import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to test the module after environment changes
// Since module is cached, we test the behavior directly

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should have correct default values when no env vars set', async () => {
    delete process.env['NODE_ENV'];
    delete process.env['PORT'];
    delete process.env['REDIS_HOST'];
    delete process.env['REDIS_PORT'];
    delete process.env['GITHUB_TOKEN'];
    delete process.env['GITHUB_OWNER'];
    delete process.env['GITHUB_REPO'];
    delete process.env['GITHUB_ISSUE_STRATEGY'];
    delete process.env['GITHUB_POLL_INTERVAL_MS'];
    delete process.env['GITHUB_WEBHOOK_SECRET'];
    delete process.env['CODEX_CLI_PATH'];
    delete process.env['CODEX_MODEL'];
    delete process.env['CODEX_TIMEOUT_MS'];

    // Import fresh module
    vi.resetModules();
    const { config } = await import('./index.js');

    expect(config.env).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.redis.host).toBe('localhost');
    expect(config.redis.port).toBe(6379);
    expect(config.github.token).toBe('');
    expect(config.github.owner).toBe('');
    expect(config.github.repo).toBe('');
    expect(config.github.pollIntervalMs).toBe(60000);
    expect(config.github).not.toHaveProperty('issueStrategy');
    expect(config.github).not.toHaveProperty('webhookSecret');
    expect(config.codex.cliPath).toBe('npx @openai/codex');
    expect(config.codex.model).toBe('gpt-5.4');
    expect(config.codex.timeoutMs).toBe(300000);
  });

  it('should load config from environment variables', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['PORT'] = '8080';
    process.env['REDIS_HOST'] = 'redis.example.com';
    process.env['REDIS_PORT'] = '6380';
    process.env['GITHUB_TOKEN'] = 'test-token';
    process.env['GITHUB_OWNER'] = 'test-owner';
    process.env['GITHUB_REPO'] = 'test-repo';
    process.env['GITHUB_ISSUE_STRATEGY'] = 'webhook';
    process.env['GITHUB_POLL_INTERVAL_MS'] = '30000';
    process.env['GITHUB_WEBHOOK_SECRET'] = 'test-secret';
    process.env['CODEX_CLI_PATH'] = '/usr/local/bin/codex';
    process.env['CODEX_MODEL'] = 'gpt-5.4-mini';
    process.env['CODEX_TIMEOUT_MS'] = '600000';

    // Import fresh module
    vi.resetModules();
    const { config } = await import('./index.js');

    expect(config.env).toBe('production');
    expect(config.port).toBe(8080);
    expect(config.redis.host).toBe('redis.example.com');
    expect(config.redis.port).toBe(6380);
    expect(config.github.token).toBe('test-token');
    expect(config.github.owner).toBe('test-owner');
    expect(config.github.repo).toBe('test-repo');
    expect(config.github.pollIntervalMs).toBe(30000);
    expect(config.github).not.toHaveProperty('issueStrategy');
    expect(config.github).not.toHaveProperty('webhookSecret');
    expect(config.codex.cliPath).toBe('/usr/local/bin/codex');
    expect(config.codex.model).toBe('gpt-5.4-mini');
    expect(config.codex.timeoutMs).toBe(600000);
  });

  it('should ignore legacy issue strategy and webhook secret environment variables', async () => {
    process.env['GITHUB_ISSUE_STRATEGY'] = 'webhook';
    process.env['GITHUB_WEBHOOK_SECRET'] = 'legacy-secret';

    vi.resetModules();
    const { config } = await import('./index.js');

    expect(config.github).not.toHaveProperty('issueStrategy');
    expect(config.github).not.toHaveProperty('webhookSecret');
  });

  it('should use default poll interval for invalid poll interval value', async () => {
    process.env['GITHUB_POLL_INTERVAL_MS'] = 'invalid';

    vi.resetModules();
    const { config } = await import('./index.js');

    expect(config.github.pollIntervalMs).toBe(60000);
  });

  it('should use default poll interval for values less than 1000ms', async () => {
    process.env['GITHUB_POLL_INTERVAL_MS'] = '500';

    vi.resetModules();
    const { config } = await import('./index.js');

    expect(config.github.pollIntervalMs).toBe(60000);
  });

  it('should use default timeout for invalid timeout value', async () => {
    process.env['CODEX_TIMEOUT_MS'] = 'invalid';

    vi.resetModules();
    const { config } = await import('./index.js');

    expect(config.codex.timeoutMs).toBe(300000);
  });

  it('should use default timeout for values less than 1ms', async () => {
    process.env['CODEX_TIMEOUT_MS'] = '0';

    vi.resetModules();
    const { config } = await import('./index.js');

    expect(config.codex.timeoutMs).toBe(300000);
  });
});
