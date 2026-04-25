import { describe, it, expect, vi } from 'vitest';
import { createGitHubClient } from './client.js';

// Mock the config module
vi.mock('../config/index.js', () => ({
  config: {
    github: {
      token: 'test-token-123',
    },
  },
}));

describe('GitHub Client', () => {
  describe('createGitHubClient', () => {
    it('should create an Octokit client instance', () => {
      const client = createGitHubClient();
      expect(client).toBeDefined();
      expect(typeof client).toBe('object');
    });

    it('should have auth configured from config token', async () => {
      const client = createGitHubClient();
      // Octokit.auth() returns an object with the token
      const auth = await client.auth() as { token: string };
      expect(auth.token).toBe('test-token-123');
    });

    it('should return a new instance on each call', () => {
      const client1 = createGitHubClient();
      const client2 = createGitHubClient();
      expect(client1).not.toBe(client2);
    });
  });
});