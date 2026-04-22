import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { CodexProviderJobData, GitHubIssue } from '../types/index.js';

// Mock the config module
vi.mock('../config/index.js', () => ({
  config: {
    redis: {
      host: 'localhost',
      port: 6379,
    },
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
      issueStrategy: 'polling',
      pollIntervalMs: 60000,
    },
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { spawn } from 'child_process';
import { processCodex } from './codex-provider.js';

function createMockJob(data: CodexProviderJobData): Job<CodexProviderJobData> {
  return {
    id: 'job-123',
    data,
  } as unknown as Job<CodexProviderJobData>;
}

function createMockIssue(number: number, title: string, body: string | null): GitHubIssue {
  return {
    id: 100 + number,
    number,
    title,
    body,
    state: 'open',
    labels: [],
    assignee: null,
    createdAt: '2026-04-22T00:00:00Z',
    updatedAt: '2026-04-22T00:00:00Z',
  };
}

function createGitMockProcess(exitCode: number = 0): ReturnType<typeof spawn> {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(''));
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(''));
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      // Immediately resolve close event for git commands
      if (event === 'close') {
        setTimeout(() => cb(exitCode), 0);
      }
    }),
    kill: vi.fn(),
  } as unknown as ReturnType<typeof spawn>;
}

function createCodexMockProcess(exitCode: number = 0): ReturnType<typeof spawn> {
  return {
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(exitCode), 10);
      }
    }),
    kill: vi.fn(),
  } as unknown as ReturnType<typeof spawn>;
}

describe('processCodex', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('should export codexProviderHandler', async () => {
    const { codexProviderHandler } = await import('./codex-provider.js');
    expect(typeof codexProviderHandler).toBe('function');
  });

  it('should checkout the branch and spawn codex process', async () => {
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    // Verify checkout was called
    expect(mockSpawn).toHaveBeenCalledWith('git', ['checkout', 'issue-1-test-issue'], expect.any(Object));

    // Verify codex was spawned
    expect(mockSpawn).toHaveBeenCalledWith(
      'npx @openai/codex',
      [expect.stringContaining('Issue #1: Test Issue')],
      expect.any(Object)
    );
  });

  it('should throw error when codex process fails', async () => {
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return createCodexMockProcess(1); // Exit code 1 = failure
    });

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await expect(processCodex(job)).rejects.toThrow('codex process failed with exit code 1');
  });

  it('should use CODEX_CLI_PATH from environment when set', async () => {
    const originalPath = process.env['CODEX_CLI_PATH'];
    process.env['CODEX_CLI_PATH'] = '/custom/path/to/codex';

    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    expect(mockSpawn).toHaveBeenCalledWith(
      '/custom/path/to/codex',
      expect.any(Array),
      expect.any(Object)
    );

    if (originalPath !== undefined) {
      process.env['CODEX_CLI_PATH'] = originalPath;
    } else {
      delete process.env['CODEX_CLI_PATH'];
    }
  });

  it('should handle issue with null body', async () => {
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    const issue = createMockIssue(1, 'Test Issue', null);
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    // Verify codex was spawned with default body text
    expect(mockSpawn).toHaveBeenCalledWith(
      'npx @openai/codex',
      [expect.stringContaining('No description provided')],
      expect.any(Object)
    );
  });

});
