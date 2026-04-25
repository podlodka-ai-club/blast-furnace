import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { CodexProviderJobData, GitHubIssue } from '../types/index.js';

// Use vi.hoisted to avoid hoisting issues with vi.mock
const { mockCreateJobLogger } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
}));

// Mock working-dir utilities - must be hoisted before vi.mock
const { mockCreateTempWorkingDir, mockCloneRepoInto, mockCleanupWorkingDir } = vi.hoisted(() => ({
  mockCreateTempWorkingDir: vi.fn(),
  mockCloneRepoInto: vi.fn(),
  mockCleanupWorkingDir: vi.fn(),
}));

// Mock pullRequests module
const { mockCreatePullRequest } = vi.hoisted(() => ({
  mockCreatePullRequest: vi.fn(),
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
    codex: {
      cliPath: 'npx @openai/codex',
      timeoutMs: 300000,
    },
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  createLogger: mockCreateJobLogger,
}));

// Mock working-dir utilities
vi.mock('../utils/working-dir.js', () => ({
  createTempWorkingDir: mockCreateTempWorkingDir,
  cloneRepoInto: mockCloneRepoInto,
  cleanupWorkingDir: mockCleanupWorkingDir,
  getRepoRemoteUrl: () => 'https://test-token@github.com/test-owner/test-repo.git',
}));

// Mock pullRequests module
vi.mock('../github/pullRequests.js', () => ({
  createPullRequest: mockCreatePullRequest,
}));

import { spawn } from 'child_process';
import * as nodePty from 'node-pty';
import { processCodex } from './codex-provider.js';

const TEMP_DIR = '/tmp/codex-abc123';

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

function createCodexMockProcess(exitCode: number = 0): ReturnType<typeof nodePty.spawn> {
  return {
    onData: vi.fn(),
    onExit: vi.fn((callback: (exit: { exitCode: number; reason?: string }) => void) => {
      setTimeout(() => callback({ exitCode, reason: '' }), 10);
    }),
    kill: vi.fn(),
  } as unknown as ReturnType<typeof nodePty.spawn>;
}

describe('processCodex', () => {
  // Track original CODEX_CLI_PATH to restore after tests that modify it
  const originalCodexPath = process.env['CODEX_CLI_PATH'];

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
    // Setup default working-dir mocks
    mockCreateTempWorkingDir.mockResolvedValue(TEMP_DIR);
    mockCloneRepoInto.mockResolvedValue(undefined);
    mockCleanupWorkingDir.mockResolvedValue(undefined);
    // Setup default createPullRequest mock
    mockCreatePullRequest.mockResolvedValue({
      number: 42,
      htmlUrl: 'https://github.com/test-owner/test-repo/pull/42',
    });
  });

  afterEach(() => {
    // Restore CODEX_CLI_PATH after tests that modify it
    if (originalCodexPath !== undefined) {
      process.env['CODEX_CLI_PATH'] = originalCodexPath;
    } else {
      delete process.env['CODEX_CLI_PATH'];
    }
  });

  it('should export codexProviderHandler', async () => {
    const { codexProviderHandler } = await import('./codex-provider.js');
    expect(typeof codexProviderHandler).toBe('function');
  });

  it('should create temp directory, clone repo, checkout branch, and spawn codex process', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        // rev-parse fails (exit code 1) to indicate branch doesn't exist locally
        if (args[0] === 'rev-parse') {
          return createGitMockProcess(1);
        }
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation((_cmd: string, _args: string[]) => {
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

    // Verify temp working dir was created
    expect(mockCreateTempWorkingDir).toHaveBeenCalledWith('codex');

    // Verify repo was cloned into temp dir
    expect(mockCloneRepoInto).toHaveBeenCalledWith(
      TEMP_DIR,
      'https://test-token@github.com/test-owner/test-repo.git'
    );

    // Verify fetch was called with explicit URL to get the remote branch
    expect(mockSpawn).toHaveBeenCalledWith('git', ['fetch', 'https://test-token@github.com/test-owner/test-repo.git', 'heads/issue-1-test-issue'], expect.any(Object));
    // Verify branch existence was checked (and found not to exist)
    expect(mockSpawn).toHaveBeenCalledWith('git', ['rev-parse', '--verify', '--quiet', 'issue-1-test-issue'], expect.any(Object));
    // Verify checkout was called to create local tracking branch
    expect(mockSpawn).toHaveBeenCalledWith('git', ['checkout', '-b', 'issue-1-test-issue', '--track', 'origin/issue-1-test-issue'], expect.any(Object));

    // Verify codex was spawned in temp directory
    expect(mockPtySpawn).toHaveBeenCalledWith(
      'npx',
      ['@openai/codex', expect.stringContaining('Issue #1: Test Issue')],
      expect.objectContaining({ cwd: TEMP_DIR })
    );

    // Verify cleanup was called
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  });

  it('should cleanup temp directory even when codex process fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => createCodexMockProcess(1)); // Exit code 1 = failure

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await expect(processCodex(job)).rejects.toThrow('codex process failed with exit code 1');

    // Verify cleanup was still called even though codex failed
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  });

  it('should cleanup temp directory even when checkout fails', async () => {
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        // Make fetch fail - use exit code 1 which is handled as a regular error
        // The retry logic will kick in (1s + 2s + 4s = 7s total) before finally throwing
        if (args[0] === 'fetch') {
          return createGitMockProcess(128);
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

    await expect(processCodex(job)).rejects.toThrow();

    // Verify cleanup was still called even though checkout failed
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  }, 10000); // 10s timeout to account for retry delays

  it('should throw error when codex process fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => createCodexMockProcess(1)); // Exit code 1 = failure

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
    process.env['CODEX_CLI_PATH'] = '/custom/path/to/codex';

    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    expect(mockPtySpawn).toHaveBeenCalledWith(
      '/custom/path/to/codex',
      [expect.stringContaining('Issue #1: Test Issue')],
      expect.objectContaining({ cwd: TEMP_DIR })
    );
  });

  it('should handle issue with null body', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    const issue = createMockIssue(1, 'Test Issue', null);
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    // Verify codex was spawned with default body text
    expect(mockPtySpawn).toHaveBeenCalledWith(
      'npx',
      ['@openai/codex', expect.stringContaining('No description provided')],
      expect.any(Object)
    );
  });

  it('should commit changes when codex makes modifications', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

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

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

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
    // Verify git push was called after commit
    expect(mockSpawn).toHaveBeenCalledWith(
      'git',
      ['push', 'https://test-token@github.com/test-owner/test-repo.git', 'issue-1-test-issue'],
      expect.any(Object)
    );
    // Verify PR was created after push
    expect(mockCreatePullRequest).toHaveBeenCalledWith({
      title: 'Process issue #1: Test Issue',
      head: 'issue-1-test-issue',
      base: 'main',
      body: 'Closes #1',
    });
  });

  it('should skip commit and push when no changes are detected', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch' || args[0] === 'checkout') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          // Branch doesn't exist locally
          return createGitMockProcess(1);
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

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    // Verify fetch was called with explicit URL
    expect(mockSpawn).toHaveBeenCalledWith('git', ['fetch', 'https://test-token@github.com/test-owner/test-repo.git', 'heads/issue-1-test-issue'], expect.any(Object));
    // Verify checkout was called to create local tracking branch
    expect(mockSpawn).toHaveBeenCalledWith('git', ['checkout', '-b', 'issue-1-test-issue', '--track', 'origin/issue-1-test-issue'], expect.any(Object));
    // Verify git add was NOT called (no changes to commit)
    const addCalls = mockSpawn.mock.calls.filter(([cmd, args]) => cmd === 'git' && args[0] === 'add');
    expect(addCalls).toHaveLength(0);
    // Verify git push was NOT called (no changes)
    const pushCalls = mockSpawn.mock.calls.filter(([cmd, args]) => cmd === 'git' && args[0] === 'push');
    expect(pushCalls).toHaveLength(0);
    // Verify PR was NOT created (no changes)
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });

  it('should throw when git commit fails with real error', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    mockCreateJobLogger.mockReturnValue(mockLogger);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch' || args[0] === 'checkout') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          // Branch doesn't exist locally
          return createGitMockProcess(1);
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

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

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

    // Verify cleanup was called
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  });

  it('should stream stderr from codex process to logger', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);
    const dataHandlers: ((data: string) => void)[] = [];

    // Set up mock logger BEFORE calling processCodex
    const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    mockCreateJobLogger.mockReturnValue(mockLogger);

    mockSpawn.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => {
      return {
        onData: vi.fn((cb: (data: string) => void) => {
          dataHandlers.push(cb);
        }),
        onExit: vi.fn((cb: (exit: { exitCode: number; reason?: string }) => void) => {
          setTimeout(() => cb({ exitCode: 0, reason: '' }), 10);
        }),
        kill: vi.fn(),
      } as unknown as ReturnType<typeof nodePty.spawn>;
    });

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    // Verify a data handler was registered
    expect(dataHandlers.length).toBe(1);

    // Simulate codex writing to PTY output and verify logger is called
    // Note: PTY combines stdout/stderr into onData, so all output logs to info
    dataHandlers[0]('error message from codex');

    // Verify the output was logged with [codex] prefix
    expect(mockLogger.info).toHaveBeenCalledWith('[codex] error message from codex');
  });

  it('should use existing local branch when it already exists', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        // rev-parse succeeds (exit code 0) to indicate branch exists locally
        if (args[0] === 'rev-parse') {
          return createGitMockProcess(0);
        }
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    // Verify checkout was called (simple checkout, not -b)
    expect(mockSpawn).toHaveBeenCalledWith('git', ['checkout', 'issue-1-test-issue'], expect.any(Object));
    // Verify reset was called to update to match remote
    expect(mockSpawn).toHaveBeenCalledWith('git', ['reset', '--hard', 'origin/issue-1-test-issue'], expect.any(Object));
  });

  it('should throw when git push fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch' || args[0] === 'checkout') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          return createGitMockProcess(1);
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
        if (args[0] === 'add') {
          return createGitMockProcess();
        }
        if (args[0] === 'commit') {
          return createGitMockProcess();
        }
        // push fails
        if (args[0] === 'push') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn((e, cb) => cb(Buffer.from('remote: Permission denied'))) },
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

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    // Should throw because push failed
    await expect(processCodex(job)).rejects.toThrow('git command failed');
    // Verify PR was NOT created (push failed first)
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    // Verify cleanup still occurred
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  });

  it('should throw when createPullRequest fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch' || args[0] === 'checkout') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          return createGitMockProcess(1);
        }
        if (args[0] === 'status') {
          return {
            stdout: { on: vi.fn((e, cb) => cb(Buffer.from('M modified-file.txt'))) },
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

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    // Make createPullRequest reject
    mockCreatePullRequest.mockRejectedValue(new Error('GitHub API error: repo not found'));

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    // Should throw because PR creation failed
    await expect(processCodex(job)).rejects.toThrow('GitHub API error: repo not found');
    // Verify cleanup still occurred
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  });

  it('should throw when git reset --hard fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          // Branch exists locally
          return createGitMockProcess(0);
        }
        // checkout succeeds but reset fails
        if (args[0] === 'checkout') {
          return createGitMockProcess();
        }
        if (args[0] === 'reset') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn((e, cb) => cb(Buffer.from('fatal: ambiguous argument'))) },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setTimeout(() => cb(128), 0);
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await expect(processCodex(job)).rejects.toThrow('git command failed');
    // Verify cleanup still occurred
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  });

  it('should throw when git checkout of existing branch fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          // Branch exists locally
          return createGitMockProcess(0);
        }
        // checkout fails
        if (args[0] === 'checkout') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn((e, cb) => cb(Buffer.from('error: pathspec not found'))) },
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

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await expect(processCodex(job)).rejects.toThrow('git command failed');
    // Verify cleanup still occurred
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  });

  it('should throw when git checkout -b --track fails', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          // Branch does not exist locally
          return createGitMockProcess(1);
        }
        // checkout -b --track fails (remote branch doesn't exist)
        if (args[0] === 'checkout') {
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn((e, cb) => cb(Buffer.from("fatal: couldn't find remote ref heads/issue-1-test-issue"))) },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setTimeout(() => cb(128), 0);
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await expect(processCodex(job)).rejects.toThrow('git command failed');
    // Verify cleanup still occurred
    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  });

  it('should retry push with exponential backoff on transient failure', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);
    let pushAttempts = 0;

    mockSpawn.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') {
        if (args[0] === 'fetch' || args[0] === 'checkout') {
          return createGitMockProcess();
        }
        if (args[0] === 'rev-parse') {
          return createGitMockProcess(1);
        }
        if (args[0] === 'status') {
          return {
            stdout: { on: vi.fn((e, cb) => cb(Buffer.from('M modified-file.txt'))) },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') setTimeout(() => cb(0), 0);
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
        if (args[0] === 'add' || args[0] === 'commit') {
          return createGitMockProcess();
        }
        // Push fails first 2 attempts, succeeds on 3rd
        if (args[0] === 'push') {
          pushAttempts++;
          return {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((event: string, cb: (code: number) => void) => {
              if (event === 'close') {
                // Fail first 2 attempts, succeed on 3rd
                setTimeout(() => cb(pushAttempts >= 3 ? 0 : 1), 0);
              }
            }),
            kill: vi.fn(),
          } as unknown as ReturnType<typeof spawn>;
        }
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await processCodex(job);

    // Verify push was called 3 times (2 failures + 1 success)
    const pushCalls = mockSpawn.mock.calls.filter(([cmd, args]) => cmd === 'git' && args[0] === 'push');
    expect(pushCalls).toHaveLength(3);
    // Verify PR was still created after retry success
    expect(mockCreatePullRequest).toHaveBeenCalled();
  });

});
