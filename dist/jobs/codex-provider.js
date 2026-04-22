import { spawn } from 'child_process';
import { createJobLogger } from './logger.js';
const DEFAULT_CODEX_CLI_PATH = 'npx @openai/codex';
const DEFAULT_TIMEOUT_MS = 300000;
function getCodexConfig() {
    return {
        codexCliPath: process.env['CODEX_CLI_PATH'] ?? DEFAULT_CODEX_CLI_PATH,
        timeoutMs: parseInt(process.env['CODEX_TIMEOUT_MS'] ?? String(DEFAULT_TIMEOUT_MS), 10),
    };
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
                reject(new Error(`git command failed: ${stderr || stdout}`));
            }
        });
        child.on('error', reject);
    });
}
export async function processCodex(job) {
    const logger = createJobLogger(job);
    const { issue, branchName } = job.data;
    const config = getCodexConfig();
    logger.info(`Running codex provider for issue #${issue.number} on branch ${branchName}`);
    const repoCwd = process.env['GIT_WORKING_DIR'] ?? process.cwd();
    try {
        logger.info(`Checking out branch: ${branchName}`);
        await execGitCommand(['fetch', 'origin', `heads/${branchName}`], repoCwd);
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
    }
    catch (err) {
        logger.error(`Failed to checkout branch ${branchName}: ${err}`);
        throw err;
    }
    const prompt = `Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? '(No description provided)'}`;
    logger.info(`Spawning codex-cli with issue prompt`);
    const codexProcess = spawn(config.codexCliPath, [prompt], {
        cwd: repoCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    codexProcess.stdout?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
            logger.info(`[codex] ${line}`);
        }
    });
    codexProcess.stderr?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
            logger.error(`[codex] ${line}`);
        }
    });
    const exitCode = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            codexProcess.kill('SIGTERM');
            reject(new Error(`codex process timed out after ${config.timeoutMs}ms`));
        }, config.timeoutMs);
        codexProcess.on('close', (code) => {
            clearTimeout(timer);
            resolve(code ?? 1);
        });
        codexProcess.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
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
            const commitResult = await execGitCommand(['commit', '-m', `Processed issue #${issue.number} via codex: ${issue.title}`], repoCwd);
            logger.info(`Changes committed: ${commitResult}`);
        }
        else {
            logger.info('No changes detected, skipping commit');
        }
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('nothing to commit')) {
            logger.info('No changes detected, skipping commit');
        }
        else {
            logger.error(`Git commit failed: ${err}`);
            throw err;
        }
    }
    logger.info(`Codex provider completed for issue #${issue.number}`);
}
export const codexProviderHandler = processCodex;
