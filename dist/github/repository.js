import { config } from '../config/index.js';
export function getConfiguredRepository() {
    return {
        owner: config.github.owner,
        repo: config.github.repo,
    };
}
export function isConfiguredRepository(repository) {
    const configured = getConfiguredRepository();
    return repository.owner === configured.owner && repository.repo === configured.repo;
}
export function assertConfiguredRepository(repository) {
    if (isConfiguredRepository(repository)) {
        return;
    }
    const configured = getConfiguredRepository();
    throw new Error(`Repository identity mismatch: received ${repository.owner}/${repository.repo}, expected ${configured.owner}/${configured.repo}`);
}
