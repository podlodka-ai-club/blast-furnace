import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdir, rm, writeFile, access } from 'fs/promises';
import type { exec as execCallback } from 'child_process';

// Use vi.hoisted to ensure mocks are properly set up before vi.mock hoisting
const { mockExec } = vi.hoisted(() => {
  return {
    mockExec: vi.fn(),
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

// Mock child_process exec
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    exec: mockExec,
  };
});

// Import the functions under test
import { createTempWorkingDir, cloneRepoInto, cleanupWorkingDir, getRepoRemoteUrl } from './working-dir.js';

describe('working-dir utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock to default success behavior
    mockExec.mockReset();
    mockExec.mockImplementation((command: string, options: object, callback: (err: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, '', '');
      return {} as ReturnType<typeof execCallback>;
    });
  });

  describe('createTempWorkingDir', () => {
    it('should create a directory in /tmp with the expected prefix', async () => {
      const prefix = 'codex-test';
      const result = await createTempWorkingDir(prefix);

      // Verify it starts with /tmp and the prefix
      expect(result).toMatch(new RegExp(`^/tmp/${prefix}-[a-f0-9-]{36}$`));

      // Verify the directory actually exists (real fs operation)
      await expect(access(result)).resolves.not.toThrow();

      // Clean up
      await rm(result, { recursive: true, force: true });
    });

    it('should create directories with unique names', async () => {
      const prefix = 'codex-unique';
      const result1 = await createTempWorkingDir(prefix);
      const result2 = await createTempWorkingDir(prefix);

      expect(result1).not.toBe(result2);

      // Clean up
      await Promise.all([
        rm(result1, { recursive: true, force: true }),
        rm(result2, { recursive: true, force: true }),
      ]);
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
  });

  describe('cloneRepoInto', () => {
    it('should call git clone with correct args', async () => {
      const workingDir = '/tmp/codex-test';
      const remoteUrl = 'https://token@github.com/owner/repo.git';

      await cloneRepoInto(workingDir, remoteUrl);

      expect(mockExec).toHaveBeenCalledWith(
        `git clone "${remoteUrl}" "${workingDir}"`,
        expect.objectContaining({ cwd: workingDir }),
        expect.any(Function)
      );
    });

    // Note: Testing error handling with fatal stderr is complex because
    // child_process.exec has a custom promisify implementation that returns {stdout, stderr}.
    // When mocking exec with vi.fn(), generic promisify is used which returns just stdout.
    // This test would require a more sophisticated mock setup.
  });

  describe('getRepoRemoteUrl', () => {
    it('should return the HTTPS GitHub remote URL with token auth', () => {
      const url = getRepoRemoteUrl();
      expect(url).toBe('https://test-token@github.com/test-owner/test-repo.git');
    });
  });
});
