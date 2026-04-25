import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { CodexProviderJobData, GitHubIssue } from '../types/index.js';

// Use vi.hoisted to avoid hoisting issues with vi.mock
const { mockCreateJobLogger, mockJobQueueAdd } = vi.hoisted(() => ({
  mockCreateJobLogger: vi.fn(),
  mockJobQueueAdd: vi.fn(),
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

const { mockEnsureNodePtySpawnHelperExecutable } = vi.hoisted(() => ({
  mockEnsureNodePtySpawnHelperExecutable: vi.fn(),
}));

const { mockMoveIssueToInReview } = vi.hoisted(() => ({
  mockMoveIssueToInReview: vi.fn(),
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

vi.mock('../utils/node-pty.js', () => ({
  ensureNodePtySpawnHelperExecutable: mockEnsureNodePtySpawnHelperExecutable,
}));

vi.mock('../github/issue-labels.js', () => ({
  moveIssueToInReview: mockMoveIssueToInReview,
}));

vi.mock('./queue.js', () => ({
  jobQueue: {
    add: mockJobQueueAdd,
  },
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
    mockEnsureNodePtySpawnHelperExecutable.mockResolvedValue(undefined);
    mockMoveIssueToInReview.mockResolvedValue(['in review']);
    mockJobQueueAdd.mockResolvedValue(undefined);
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
    expect(mockEnsureNodePtySpawnHelperExecutable).toHaveBeenCalledTimes(1);
    expect(mockPtySpawn).toHaveBeenCalledWith(
      'npx',
      ['@openai/codex', 'exec', '--dangerously-bypass-approvals-and-sandbox', expect.stringContaining('Issue #1: Test Issue')],
      expect.objectContaining({ cwd: TEMP_DIR })
    );

    expect(mockJobQueueAdd).toHaveBeenCalledWith('review', {
      taskId: 'test-task',
      type: 'review',
      issue,
      branchName: 'issue-1-test-issue',
      repoPath: TEMP_DIR,
    });
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
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

    mockSpawn.mockImplementation((cmd: string, _args: string[]) => {
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
      ['exec', '--dangerously-bypass-approvals-and-sandbox', expect.stringContaining('Issue #1: Test Issue')],
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
      ['@openai/codex', 'exec', '--dangerously-bypass-approvals-and-sandbox', expect.stringContaining('No description provided')],
      expect.any(Object)
    );
  });

  it('should enqueue review after codex succeeds without committing, pushing, creating a pull request, or moving labels', async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockPtySpawn = vi.mocked(nodePty.spawn);

    mockSpawn.mockImplementation((cmd: string, _args: string[]) => {
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

    expect(mockJobQueueAdd).toHaveBeenCalledWith('review', {
      taskId: 'test-task',
      type: 'review',
      issue,
      branchName: 'issue-1-test-issue',
      repoPath: TEMP_DIR,
    });
    const statusCalls = mockSpawn.mock.calls.filter(([cmd, args]) => cmd === 'git' && args[0] === 'status');
    expect(statusCalls).toHaveLength(0);
    const addCalls = mockSpawn.mock.calls.filter(([cmd, args]) => cmd === 'git' && args[0] === 'add');
    expect(addCalls).toHaveLength(0);
    const commitCalls = mockSpawn.mock.calls.filter(([cmd, args]) => cmd === 'git' && args[0] === 'commit');
    expect(commitCalls).toHaveLength(0);
    const pushCalls = mockSpawn.mock.calls.filter(([cmd, args]) => cmd === 'git' && args[0] === 'push');
    expect(pushCalls).toHaveLength(0);
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
    expect(mockMoveIssueToInReview).not.toHaveBeenCalled();
    expect(mockCleanupWorkingDir).not.toHaveBeenCalled();
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

  it('should cleanup temp directory when review enqueue fails', async () => {
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
        return createGitMockProcess();
      }
      return createCodexMockProcess();
    });

    mockPtySpawn.mockImplementation(() => createCodexMockProcess());
    mockJobQueueAdd.mockRejectedValue(new Error('Queue add failed'));

    const issue = createMockIssue(1, 'Test Issue', 'Test body');
    const job = createMockJob({
      taskId: 'test-task',
      type: 'codex-provider',
      issue,
      branchName: 'issue-1-test-issue',
    });

    await expect(processCodex(job)).rejects.toThrow('Queue add failed');

    expect(mockCleanupWorkingDir).toHaveBeenCalledWith(TEMP_DIR);
  });

});
