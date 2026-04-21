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
    expect(config.github.issueStrategy).toBe('polling');
    expect(config.github.pollIntervalMs).toBe(60000);
    expect(config.github.webhookSecret).toBeUndefined();
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
    expect(config.github.issueStrategy).toBe('webhook');
    expect(config.github.pollIntervalMs).toBe(30000);
    expect(config.github.webhookSecret).toBe('test-secret');
  });

  it('should default to polling strategy for invalid issue strategy value', async () => {
    process.env['GITHUB_ISSUE_STRATEGY'] = 'invalid';

    vi.resetModules();
    const { config } = await import('./index.js');

    expect(config.github.issueStrategy).toBe('polling');
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
});
