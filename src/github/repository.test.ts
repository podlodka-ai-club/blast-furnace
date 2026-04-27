import { describe, expect, it, vi } from 'vitest';
import {
  assertConfiguredRepository,
  getConfiguredRepository,
  isConfiguredRepository,
} from './repository.js';

vi.mock('../config/index.js', () => ({
  config: {
    github: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));

describe('repository identity helpers', () => {
  it('returns the configured repository identity', () => {
    expect(getConfiguredRepository()).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
    });
  });

  it('recognizes matching repository identity', () => {
    expect(isConfiguredRepository({
      owner: 'test-owner',
      repo: 'test-repo',
    })).toBe(true);
  });

  it('rejects mismatched repository identity with a clear error', () => {
    expect(() => assertConfiguredRepository({
      owner: 'other-owner',
      repo: 'other-repo',
    })).toThrow('Repository identity mismatch');
  });
});
