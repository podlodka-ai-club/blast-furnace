import { describe, it, expect, vi } from 'vitest';
import { pushBranch, getRef } from './branches.js';
import { githubClient } from './client.js';

// Mock the client module
vi.mock('./client.js', () => ({
  githubClient: {
    git: {
      createRef: vi.fn(),
      getRef: vi.fn(),
    },
  },
}));

// Mock the config module
vi.mock('../config/index.js', () => ({
  config: {
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

describe('branches', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('pushBranch', () => {
    it('should create a ref with default force false', async () => {
      const mockCreateRef = vi.fn().mockResolvedValue({ data: {} });
      vi.mocked(githubClient.git.createRef).mockImplementation(mockCreateRef);

      await pushBranch('feature/test', 'abc123');

      expect(githubClient.git.createRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'refs/heads/feature/test',
        sha: 'abc123',
        force: false,
      });
    });

    it('should create a ref with force true when specified', async () => {
      const mockCreateRef = vi.fn().mockResolvedValue({ data: {} });
      vi.mocked(githubClient.git.createRef).mockImplementation(mockCreateRef);

      await pushBranch('feature/test', 'abc123', true);

      expect(githubClient.git.createRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'refs/heads/feature/test',
        sha: 'abc123',
        force: true,
      });
    });

    it('should create a ref for a simple branch name', async () => {
      const mockCreateRef = vi.fn().mockResolvedValue({ data: {} });
      vi.mocked(githubClient.git.createRef).mockImplementation(mockCreateRef);

      await pushBranch('main', 'def456');

      expect(githubClient.git.createRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'refs/heads/main',
        sha: 'def456',
        force: false,
      });
    });
  });

  describe('getRef', () => {
    it('should get the SHA for a branch', async () => {
      const mockGetRef = vi.fn().mockResolvedValue({
        data: {
          object: {
            sha: 'abc123def456',
          },
        },
      });
      vi.mocked(githubClient.git.getRef).mockImplementation(mockGetRef);

      const result = await getRef('main');

      expect(githubClient.git.getRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'heads/main',
      });
      expect(result).toBe('abc123def456');
    });

    it('should get the SHA for a nested branch', async () => {
      const mockGetRef = vi.fn().mockResolvedValue({
        data: {
          object: {
            sha: 'xyz789',
          },
        },
      });
      vi.mocked(githubClient.git.getRef).mockImplementation(mockGetRef);

      const result = await getRef('feature/my-feature');

      expect(githubClient.git.getRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        ref: 'heads/feature/my-feature',
      });
      expect(result).toBe('xyz789');
    });
  });
});