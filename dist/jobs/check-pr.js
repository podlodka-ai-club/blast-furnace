import { cleanupWorkingDir } from '../utils/working-dir.js';
import { createJobLogger } from './logger.js';
export async function processCheckPr(job) {
    const logger = createJobLogger(job);
    const { issue, branchName, repoPath, pullRequest } = job.data;
    logger.info(`Checking PR #${pullRequest.number} for issue #${issue.number} on branch ${branchName}`);
    logger.info(`Cleaning up temp working directory: ${repoPath}`);
    await cleanupWorkingDir(repoPath);
}
export const checkPrHandler = processCheckPr;
