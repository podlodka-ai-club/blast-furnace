import { spawn } from 'child_process';
import type { Job } from 'bullmq';
import type { CodexProviderJobData } from '../types/index.js';
import { createJobLogger } from './logger.js';

const DEFAULT_CODEX_CLI_PATH = 'npx @openai/codex';
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes

/**
 * Configuration for codex provider
 */
interface CodexProviderConfig {
  codexCliPath: string;
  timeoutMs: number;
}

function getCodexConfig(): CodexProviderConfig {
  return {
    codexCliPath: process.env['CODEX_CLI_PATH'] ?? DEFAULT_CODEX_CLI_PATH,
    timeoutMs: parseInt(process.env['CODEX_TIMEOUT_MS'] ?? String(DEFAULT_TIMEOUT_MS), 10),
  };
}

/**
 * Execute a git command in the repository
 */
function execGitCommand(args: string[], cwd: string): Promise<string> {
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
      } else {
        reject(new Error(`git command failed: ${stderr || stdout}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Process a GitHub issue using OpenAI's codex-cli
 * This job:
 * 1. Checks out the specified branch
 * 2. Spawns codex-cli with the issue as a prompt
 * 3. Commits any changes made by codex
 */
export async function processCodex(job: Job<CodexProviderJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const { issue, branchName } = job.data;
  const config = getCodexConfig();

  logger.info(`Running codex provider for issue #${issue.number} on branch ${branchName}`);

  // Determine the working directory (repository root)
  const repoCwd = process.env['GIT_WORKING_DIR'] ?? process.cwd();

  // Step 1: Fetch the branch and checkout as a local tracking branch
  try {
    logger.info(`Checking out branch: ${branchName}`);
    // First fetch the specific branch to ensure we have the remote ref
    await execGitCommand(['fetch', 'origin', `heads/${branchName}`], repoCwd);
    // Check if branch already exists locally
    const branchExists = await execGitCommand(['rev-parse', '--verify', '--quiet', branchName], repoCwd)
      .then(() => true)
      .catch(() => false);

    if (branchExists) {
      // Branch exists locally - checkout and update to match remote
      await execGitCommand(['checkout', branchName], repoCwd);
      await execGitCommand(['reset', '--hard', `origin/${branchName}`], repoCwd);
    } else {
      // Create a new local branch tracking the remote branch
      await execGitCommand(['checkout', '-b', branchName, '--track', `origin/${branchName}`], repoCwd);
    }
  } catch (err) {
    logger.error(`Failed to checkout branch ${branchName}: ${err}`);
    throw err;
  }

  // Step 2: Build the prompt from issue title and body
  const prompt = `Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? '(No description provided)'}`;

  // Step 3: Spawn codex-cli as a child process
  // Note: We avoid shell: true to prevent shell injection from user-controlled prompt
  logger.info(`Spawning codex-cli with issue prompt`);
  const codexProcess = spawn(config.codexCliPath, [prompt], {
    cwd: repoCwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Stream stdout to logger
  codexProcess.stdout?.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      logger.info(`[codex] ${line}`);
    }
  });

  // Stream stderr to logger
  codexProcess.stderr?.on('data', (data) => {
    const line = data.toString().trim();
    if (line) {
      logger.error(`[codex] ${line}`);
    }
  });

  // Step 4: Wait for process to complete with timeout
  const exitCode = await new Promise<number>((resolve, reject) => {
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

  // Step 5: Commit any changes made by codex
  try {
    // Check if there are any changes to commit
    const status = await execGitCommand(['status', '--porcelain'], repoCwd);

    if (status) {
      logger.info('Changes detected, committing...');
      await execGitCommand(['add', '-A'], repoCwd);
      const commitResult = await execGitCommand(
        ['commit', '-m', `Processed issue #${issue.number} via codex: ${issue.title}`],
        repoCwd
      );
      logger.info(`Changes committed: ${commitResult}`);
    } else {
      logger.info('No changes detected, skipping commit');
    }
  } catch (err) {
    // Distinguish "nothing to commit" from actual failures
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes('nothing to commit')) {
      logger.info('No changes detected, skipping commit');
    } else {
      // Actual commit failure - log and throw as the codex execution may have produced changes
      // that failed to commit for legitimate reasons (e.g., git author not configured, disk full)
      logger.error(`Git commit failed: ${err}`);
      throw err;
    }
  }

  logger.info(`Codex provider completed for issue #${issue.number}`);
}

/**
 * Handler for codex provider jobs - exported for use in worker
 */
export const codexProviderHandler = processCodex;
