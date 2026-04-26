import { config } from '../config/index.js';
import type { RepositoryIdentity } from '../types/index.js';

export function getConfiguredRepository(): RepositoryIdentity {
  return {
    owner: config.github.owner,
    repo: config.github.repo,
  };
}

export function isConfiguredRepository(repository: RepositoryIdentity): boolean {
  const configured = getConfiguredRepository();
  return repository.owner === configured.owner && repository.repo === configured.repo;
}

export function assertConfiguredRepository(repository: RepositoryIdentity): void {
  if (isConfiguredRepository(repository)) {
    return;
  }

  const configured = getConfiguredRepository();
  throw new Error(
    `Repository identity mismatch: received ${repository.owner}/${repository.repo}, expected ${configured.owner}/${configured.repo}`
  );
}
