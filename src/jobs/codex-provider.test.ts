import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { CodexProviderJobData, GitHubIssue } from '../types/index.js';

// Use vi.hoisted to avoid hoisting issues with vi.mock
const { mockCreateJobLogger } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
}));

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
  createLogger: mockCreateJobLogger,
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

function createGitMockProcessWithExitCode(exitCode: number): ReturnType<typeof spawn> {
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
    // Setup default mock logger
    mockCreateJobLogger.mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    });
  });

  it('should export codexProviderHandler', async () => {
    const { codexProviderHandler } = await import('./codex-provider.js');
    expect(typeof codexProviderHandler).toBe('function');
  });

  it('should checkout the branch and spawn codex process', async () => {
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        // rev-parse fails (exit code 1) to indicate branch doesn't exist locally
        if (args[0] === 'rev-parse') {
          return createGitMockProcessWithExitCode(1);
        }
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

    // Verify fetch was called first to get the remote branch
    expect(mockSpawn).toHaveBeenCalledWith('git', ['fetch', 'origin', 'heads/issue-1-test-issue'], expect.any(Object));
    // Verify branch existence was checked (and found not to exist)
    expect(mockSpawn).toHaveBeenCalledWith('git', ['rev-parse', '--verify', '--quiet', 'issue-1-test-issue'], expect.any(Object));
    // Verify checkout was called to create local tracking branch
    expect(mockSpawn).toHaveBeenCalledWith('git', ['checkout', '-b', 'issue-1-test-issue', '--track', 'origin/issue-1-test-issue'], expect.any(Object));

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

  it('should commit changes when codex makes modifications', async () => {
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'checkout') {
          return createGitMockProcess();
        }
        if (args[0] === 'status') {
          let dataCallback: ((data: Buffer) => void) | null = null;
          return {
            stdout: {
              on: vi.fn((event: string, cb: (data: Buffer) => void) => {
                if (event === 'data') dataCallback = cb;
              }),
            },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') {
                setTimeout(() => {
                  // Emit data before close to simulate real git status output
                  if (dataCallback) dataCallback(Buffer.from('M modified-file.txt'));
                  cb(0);
                }, 0);
              }
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
        if (args[0] === 'add' || args[0] === 'commit') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setTimeout(() => cb(0), 0);
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
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

    // Verify git add was called
    expect(mockSpawn).toHaveBeenCalledWith('git', ['add', '-A'], expect.any(Object));
    // Verify git commit was called
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', expect.stringContaining('Processed issue')],
      expect.any(Object)
    );
  });

  it('should skip commit when no changes are detected', async () => {
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch' || args[0] === 'checkout') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          // Branch doesn't exist locally
          return createGitMockProcessWithExitCode(1);
        }
        if (args[0] === 'status') {
          // Return empty string to indicate no changes
          return {
            stdout: { on: vi.fn((e, cb) => cb(Buffer.from(''))) },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setTimeout(() => cb(0), 0);
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
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

    // Verify fetch was called first
    expect(mockSpawn).toHaveBeenCalledWith('git', ['fetch', 'origin', 'heads/issue-1-test-issue'], expect.any(Object));
    // Verify checkout was called to create local tracking branch
    expect(mockSpawn).toHaveBeenCalledWith('git', ['checkout', '-b', 'issue-1-test-issue', '--track', 'origin/issue-1-test-issue'], expect.any(Object));
    // Verify git add was NOT called (no changes to commit)
    const addCalls = mockSpawn.mock.calls.filter(([cmd, args]) => cmd === 'git' && args[0] === 'add');
    expect(addCalls).toHaveLength(0);
  });

  it('should throw when git commit fails with real error', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    mockCreateJobLogger.mockReturnValue(mockLogger);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch' || args[0] === 'checkout') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          // Branch doesn't exist locally
          return createGitMockProcessWithExitCode(1);
        }
        if (args[0] === 'status') {
          // Return non-empty to indicate changes exist
          return {
            stdout: { on: vi.fn((e, cb) => cb(Buffer.from('M modified-file.txt'))) },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setTimeout(() => cb(0), 0);
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
        // git add succeeds but git commit fails with non-"nothing to commit" error
        if (args[0] === 'add') {
          return {
            stdout: { on: vi.fn((e, cb) => cb(Buffer.from(''))) },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setTimeout(() => cb(0), 0);
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
        if (args[0] === 'commit') {
          // Commit fails with non-zero exit code and error message that is NOT "nothing to commit"
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn((e, cb) => cb(Buffer.from('Author identity unknown'))) },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setTimeout(() => cb(1), 0);
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
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

    // Should throw because commit failed with a real error (not "nothing to commit")
    await expect(processCodex(job)).rejects.toThrow('git command failed');

    // Verify the error was logged
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should stream stderr from codex process to logger', async () => {
    const mockSpawn = vi.mocked(spawn);
    const stderrHandlers: ((data: Buffer) => void)[] = [];

    // Set up mock logger BEFORE calling processCodex
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    mockCreateJobLogger.mockReturnValue(mockLogger);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return {
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') stderrHandlers.push(cb);
          }),
        },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') setTimeout(() => cb(0), 10);
        }),
        kill: vi.fn(),
      } as unknown as ReturnType<typeof spawn>;
    });

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    // Verify a stderr data handler was registered
    expect(stderrHandlers.length).toBe(1);

    // Simulate codex writing to stderr and verify logger is called
    stderrHandlers[0](Buffer.from('error message from codex'));

    // Verify the error was logged with [codex] prefix
    expect(mockLogger.error).toHaveBeenCalledWith('[codex] error message from codex');
  });

});
