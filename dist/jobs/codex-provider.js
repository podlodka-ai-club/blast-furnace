import { spawn } from 'child_process';
import * as pty from 'node-pty';
import { config } from '../config/index.js';
import { createJobLogger } from './logger.js';
import { createTempWorkingDir, cloneRepoInto, cleanupWorkingDir, getRepoRemoteUrl } from '../utils/working-dir.js';
import { createPullRequest } from '../github/pullRequests.js';
const DEFAULT_TIMEOUT_MS = 300000;
async function fetchBranchWithRetry(branchName, cwd, logger, maxRetries = 3) {
    const remoteUrl = getRepoRemoteUrl();
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await execGitCommand(['fetch', remoteUrl, `heads/${branchName}`], cwd);
            return;
        }
        catch (err) {
            if (attempt === maxRetries)
                throw err;
            const delay = Math.pow(2, attempt - 1) * 1000;
            logger.warn(`Fetch attempt ${attempt} failed for ${branchName}: ${err}, retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}
async function pushWithRetry(remoteUrl, branchName, cwd, logger, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await execGitCommand(['push', remoteUrl, branchName], cwd);
            return;
        }
        catch (err) {
            if (attempt === maxRetries)
                throw err;
            const delay = Math.pow(2, attempt - 1) * 1000;
            logger.warn(`Push attempt ${attempt} failed for ${branchName}: ${err}, retrying in ${delay}ms...`);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}
function sanitizeForGit(text, maxLength = 200) {
    return text.replace(/[\r\n]/g, ' ').slice(0, maxLength);
}
function execGitCommand(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            }
            else {
                reject(new Error(`git command failed: ${stderr}`));
            }
        });
        child.on('error', reject);
    });
}
export async function processCodex(job) {
    const logger = createJobLogger(job);
    const { issue, branchName } = job.data;
    const codexCliPath = process.env['CODEX_CLI_PATH'] ?? config.codex?.cliPath ?? 'npx @openai/codex';
    const timeoutMs = parseInt(process.env['CODEX_TIMEOUT_MS'] ?? String(config.codex?.timeoutMs ?? DEFAULT_TIMEOUT_MS), 10);
    logger.info(`Running codex provider for issue #${issue.number} on branch ${branchName}`);
    let repoCwd = null;
    try {
        repoCwd = await createTempWorkingDir('codex');
        const remoteUrl = getRepoRemoteUrl();
        logger.info(`Cloning repository into temp directory: ${repoCwd}`);
        await cloneRepoInto(repoCwd, remoteUrl);
        logger.info(`Checking out branch: ${branchName}`);
        await fetchBranchWithRetry(branchName, repoCwd, logger);
        const branchExists = await execGitCommand(['rev-parse', '--verify', '--quiet', branchName], repoCwd)
            .then(() => true)
            .catch(() => false);
        if (branchExists) {
            await execGitCommand(['checkout', branchName], repoCwd);
            await execGitCommand(['reset', '--hard', `origin/${branchName}`], repoCwd);
        }
        else {
            await execGitCommand(['checkout', '-b', branchName, '--track', `origin/${branchName}`], repoCwd);
        }
        const prompt = `Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? '(No description provided)'}`;
        const cliParts = codexCliPath.split(/\s+/).filter(Boolean);
        if (cliParts.length === 0) {
            throw new Error('CODEX_CLI_PATH must not be empty');
        }
        const cliCmd = cliParts[0];
        const cliArgs = cliParts.slice(1);
        logger.info(`Spawning codex-cli with issue prompt`);
        const ptxProcess = pty.spawn(cliCmd, [...cliArgs, prompt], {
            cwd: repoCwd,
            name: 'xterm-color',
            env: { ...process.env },
        });
        ptxProcess.onData((data) => {
            const line = data.toString().trim();
            if (line) {
                logger.info(`[codex] ${line}`);
            }
        });
        const exitCode = await new Promise((resolve, reject) => {
            let settled = false;
            const settle = (fn) => {
                if (!settled) {
                    settled = true;
                    fn();
                }
            };
            const timer = setTimeout(() => {
                ptxProcess.kill('SIGTERM');
                settle(() => reject(new Error(`codex process timed out after ${timeoutMs}ms`)));
            }, timeoutMs);
            ptxProcess.onExit(({ exitCode }) => {
                clearTimeout(timer);
                settle(() => resolve(exitCode));
            });
        });
        if (exitCode !== 0) {
            logger.error(`codex process exited with code ${exitCode}`);
            throw new Error(`codex process failed with exit code ${exitCode}`);
        }
        logger.info('codex process completed successfully');
        try {
            const status = await execGitCommand(['status', '--porcelain'], repoCwd);
            if (status) {
                logger.info('Changes detected, committing...');
                await execGitCommand(['add', '-A'], repoCwd);
                const sanitizedTitle = sanitizeForGit(issue.title);
                const commitResult = await execGitCommand(['commit', '-m', `Processed issue #${issue.number} via codex: ${sanitizedTitle}`], repoCwd);
                logger.info(`Changes committed: ${commitResult}`);
                logger.info('Pushing changes to remote branch...');
                const pushRemoteUrl = getRepoRemoteUrl();
                await pushWithRetry(pushRemoteUrl, branchName, repoCwd, logger);
                logger.info(`Changes pushed to ${branchName}`);
                logger.info('Creating pull request...');
                const prResult = await createPullRequest({
                    title: `Process issue #${issue.number}: ${sanitizedTitle}`,
                    head: branchName,
                    base: 'main',
                    body: `Closes #${issue.number}`,
                });
                logger.info(`Pull request created: ${prResult.htmlUrl}`);
            }
            else {
                logger.info('No changes detected, skipping commit and push');
            }
        }
        catch (err) {
            logger.error(`Git operation failed: ${err}`);
            throw err;
        }
        logger.info(`Codex provider completed for issue #${issue.number}`);
    }
    finally {
        if (repoCwd) {
            logger.info(`Cleaning up temp working directory: ${repoCwd}`);
            await cleanupWorkingDir(repoCwd);
        }
    }
}
export const codexProviderHandler = processCodex;
