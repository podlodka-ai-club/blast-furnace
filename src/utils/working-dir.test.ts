import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdir, rm, writeFile, access } from 'fs/promises';

// Use vi.hoisted to ensure mocks are properly set up before vi.mock hoisting
const { mockSpawn } = vi.hoisted(() => {
  return {
    mockSpawn: vi.fn(),
  };
});

// Mock the config module
vi.mock('../config/index.js', async () => {
  const actual = await vi.importActual('../config/index.js');
  return {
    ...actual,
    config: {
      github: {
        token: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo',
      },
    },
  };
});

// Mock child_process spawn
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    spawn: mockSpawn,
  };
});

// Import the functions under test
import { createTempWorkingDir, cloneRepoInto, cleanupWorkingDir, getRepoRemoteUrl } from './working-dir.js';

describe('working-dir utilities', () => {
  // Track temp directories created during tests for cleanup
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock to default success behavior for spawn
    mockSpawn.mockReset();
    mockSpawn.mockImplementation(() => ({
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (code: number) => void) => {
        if (event === 'close') setTimeout(() => cb(0), 0);
      }),
    }));
  });

  afterEach(async () => {
    // Clean up any temp directories created during tests
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {}))
    );
    tempDirs.length = 0;
  });

  describe('createTempWorkingDir', () => {
    it('should create a directory in /tmp with the expected prefix', async () => {
      const prefix = 'codex-test';
      const result = await createTempWorkingDir(prefix);
      tempDirs.push(result); // Track for cleanup

      // Verify it starts with /tmp and the prefix
      expect(result).toMatch(new RegExp(`^/tmp/${prefix}-[a-f0-9-]{36}$`));

      // Verify the directory actually exists (real fs operation)
      await expect(access(result)).resolves.not.toThrow();
    });

    it('should create directories with unique names', async () => {
      const prefix = 'codex-unique';
      const result1 = await createTempWorkingDir(prefix);
      const result2 = await createTempWorkingDir(prefix);
      tempDirs.push(result1, result2); // Track for cleanup

      expect(result1).not.toBe(result2);
    });

    it('should throw error when prefix contains path separators', async () => {
      await expect(createTempWorkingDir('codex/test')).rejects.toThrow('Invalid prefix');
      await expect(createTempWorkingDir('codex\\test')).rejects.toThrow('Invalid prefix');
    });

    it('should throw error when prefix contains path traversal', async () => {
      await expect(createTempWorkingDir('codex/../etc')).rejects.toThrow('Invalid prefix');
    });
  });

  describe('cleanupWorkingDir', () => {
    it('should remove the directory and its contents', async () => {
      // Create a real temp directory first
      const testDir = `/tmp/cleanup-test-${randomUUID()}`;
      await mkdir(testDir, { recursive: true });

      // Create a file inside it
      await writeFile(join(testDir, 'test.txt'), 'test content');

      // Verify it exists
      await expect(access(testDir)).resolves.not.toThrow();

      // Clean it up using our utility
      await cleanupWorkingDir(testDir);

      // Verify it's gone - access should throw
      await expect(access(testDir)).rejects.toThrow();
    });

    it('should throw error when path is not under /tmp', async () => {
      await expect(cleanupWorkingDir('/home/user/somefile')).rejects.toThrow('Refusing to delete non-temp directory');
      await expect(cleanupWorkingDir('/usr/local/bin')).rejects.toThrow('Refusing to delete non-temp directory');
    });
  });

  describe('cloneRepoInto', () => {
    it('should call git clone with correct args', async () => {
      const workingDir = '/tmp/codex-test';
      const remoteUrl = 'https://token@github.com/owner/repo.git';

      await cloneRepoInto(workingDir, remoteUrl);

      expect(mockSpawn).toHaveBeenCalledWith('git', ['clone', remoteUrl, '.'], {
        cwd: workingDir,
      });
    });

    it('should throw error when git clone fails', async () => {
      const workingDir = '/tmp/codex-test';
      const remoteUrl = 'https://token@github.com/owner/repo.git';

      // Mock spawn to return non-zero exit code
      mockSpawn.mockImplementation(() => ({
        stderr: { on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === 'data') cb(Buffer.from('fatal: repository not found'));
        }) },
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === 'close') setTimeout(() => cb(128), 0);
        }),
      }));

      await expect(cloneRepoInto(workingDir, remoteUrl)).rejects.toThrow('git clone failed');
    });
  });

  describe('getRepoRemoteUrl', () => {
    it('should return the HTTPS GitHub remote URL with token auth', () => {
      const url = getRepoRemoteUrl();
      expect(url).toBe('https://test-token@github.com/test-owner/test-repo.git');
    });
  });
});
