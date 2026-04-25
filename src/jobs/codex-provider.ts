import { spawn } from 'child_process';
import * as pty from 'node-pty';
import path from 'node:path';
import type { Job } from 'bullmq';
import type { CodexProviderJobData } from '../types/index.js';
import { config } from '../config/index.js';
import { createJobLogger } from './logger.js';
import { createTempWorkingDir, cloneRepoInto, cleanupWorkingDir, getRepoRemoteUrl } from '../utils/working-dir.js';
import { createPullRequest } from '../github/pullRequests.js';
import { moveIssueToInReview } from '../github/issue-labels.js';
import { ensureNodePtySpawnHelperExecutable } from '../utils/node-pty.js';

const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes
const CODEX_SUBCOMMANDS = new Set([
  'exec',
  'review',
  'login',
  'logout',
  'mcp',
  'mcp-server',
  'app-server',
  'app',
  'completion',
  'sandbox',
  'debug',
  'apply',
  'resume',
  'fork',
  'cloud',
  'features',
  'help',
]);

/**
 * Fetch a branch with exponential backoff retry
 */
async function fetchBranchWithRetry(
  branchName: string,
  cwd: string,
  logger: ReturnType<typeof createJobLogger>,
  maxRetries = 3
): Promise<void> {
  const remoteUrl = getRepoRemoteUrl();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await execGitCommand(['fetch', remoteUrl, `heads/${branchName}`], cwd);
      return; // Success
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.warn(`Fetch attempt ${attempt} failed for ${branchName}: ${err}, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Push changes to remote with exponential backoff retry
 */
async function pushWithRetry(
  remoteUrl: string,
  branchName: string,
  cwd: string,
  logger: ReturnType<typeof createJobLogger>,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await execGitCommand(['push', remoteUrl, branchName], cwd);
      return; // Success
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.warn(`Push attempt ${attempt} failed for ${branchName}: ${err}, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Sanitize a string for use in git messages and PR titles
 * Removes newlines and limits length
 */
function sanitizeForGit(text: string, maxLength = 200): string {
  return text.replace(/[\r\n]/g, ' ').slice(0, maxLength);
}

function buildCodexCliArgs(cliCmd: string, cliArgs: string[], prompt: string): string[] {
  const invocationArgs = [...cliArgs];
  const hasExplicitSubcommand = invocationArgs.some((arg) => CODEX_SUBCOMMANDS.has(arg));
  const basename = path.basename(cliCmd);
  const appearsToBeCodexCommand = basename === 'codex' || basename === 'codex-cli' || invocationArgs.some((arg) => arg.includes('codex'));

  // Run jobs through `codex exec` so the CLI stays non-interactive and doesn't block
  // on directory trust prompts.
  if (appearsToBeCodexCommand && !hasExplicitSubcommand) {
    invocationArgs.push('exec');
  }

  if (!invocationArgs.includes('--dangerously-bypass-approvals-and-sandbox')) {
    invocationArgs.push('--dangerously-bypass-approvals-and-sandbox');
  }

  invocationArgs.push(prompt);
  return invocationArgs;
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
        reject(new Error(`git command failed: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Process a GitHub issue using OpenAI's codex-cli
 * This job:
 * 1. Creates a unique temp directory in /tmp
 * 2. Clones the GitHub repo into it
 * 3. Checks out the specified branch
 * 4. Spawns codex-cli with the issue as a prompt
 * 5. Commits any changes made by codex
 * 6. Cleans up the temp directory
 */
export async function processCodex(job: Job<CodexProviderJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const { issue, branchName } = job.data;
  const codexCliPath = process.env['CODEX_CLI_PATH'] ?? config.codex?.cliPath ?? 'npx @openai/codex';
  const timeoutMs = parseInt(
    process.env['CODEX_TIMEOUT_MS'] ?? String(config.codex?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    10
  );

  logger.info(`Running codex provider for issue #${issue.number} on branch ${branchName}`);

  // Create a unique temporary working directory for this job
  let repoCwd: string | null = null;

  try {
    repoCwd = await createTempWorkingDir('codex');
    // Clone the repository into the temp directory
    // This automatically sets origin to the correct URL since we pass it to clone
    const remoteUrl = getRepoRemoteUrl();
    logger.info(`Cloning repository into temp directory: ${repoCwd}`);
    await cloneRepoInto(repoCwd, remoteUrl);

    // Step 1: Fetch the branch and checkout as a local tracking branch
    logger.info(`Checking out branch: ${branchName}`);

    // First fetch the specific branch to ensure we have the remote ref
    // Use retry to handle potential GitHub propagation delay
    await fetchBranchWithRetry(branchName, repoCwd, logger);
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

    // Step 2: Build the prompt from issue title and body
    const prompt = `Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? '(No description provided)'}`;

    // Step 3: Spawn codex-cli as a PTY (pseudo-terminal) process
    // We use node-pty because codex-cli is an interactive TTY application
    // that queries terminal capabilities and hangs without a PTY.
    // Parse the configured command so values like "npx @openai/codex"
    // become executable + args, while a direct binary path stays unchanged.
    const cliParts = codexCliPath.split(/\s+/).filter(Boolean);
    if (cliParts.length === 0) {
      throw new Error('CODEX_CLI_PATH must not be empty');
    }
    const cliCmd = cliParts[0];
    const cliArgs = cliParts.slice(1);
    const finalCliArgs = buildCodexCliArgs(cliCmd, cliArgs, prompt);
    logger.info(`Spawning codex-cli with issue prompt`);
    await ensureNodePtySpawnHelperExecutable(logger);
    const ptxProcess = pty.spawn(cliCmd, finalCliArgs, {
      cwd: repoCwd,
      name: 'xterm-color',
      env: { ...process.env },
    });

    // Stream PTY output to logger
    ptxProcess.onData((data: string) => {
      const line = data.toString().trim();
      if (line) {
        logger.info(`[codex] ${line}`);
      }
    });

    // Step 4: Wait for PTY process to complete with timeout
    const exitCode = await new Promise<number>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };
      const timer = setTimeout(() => {
        ptxProcess.kill('SIGTERM');
        settle(() => reject(new Error(`codex process timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      ptxProcess.onExit(({ exitCode }: { exitCode: number }) => {
        clearTimeout(timer);
        settle(() => resolve(exitCode));
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
        const sanitizedTitle = sanitizeForGit(issue.title);
        const commitResult = await execGitCommand(
          ['commit', '-m', `Processed issue #${issue.number} via codex: ${sanitizedTitle}`],
          repoCwd
        );
        logger.info(`Changes committed: ${commitResult}`);

        // Step 6: Push changes to remote
        logger.info('Pushing changes to remote branch...');
        const pushRemoteUrl = getRepoRemoteUrl();
        await pushWithRetry(pushRemoteUrl, branchName, repoCwd, logger);
        logger.info(`Changes pushed to ${branchName}`);

        // Step 7: Create pull request
        logger.info('Creating pull request...');
        const prResult = await createPullRequest({
          title: `Process issue #${issue.number}: ${sanitizedTitle}`,
          head: branchName,
          base: 'main',
          body: `Closes #${issue.number}`,
        });
        logger.info(`Pull request created: ${prResult.htmlUrl}`);

        try {
          const updatedLabels = await moveIssueToInReview(issue.number);
          logger.info(`Issue #${issue.number} labels updated: ${updatedLabels.join(', ')}`);
        } catch (err) {
          logger.warn(`Failed to update labels for issue #${issue.number}: ${err}`);
        }
      } else {
        logger.info('No changes detected, skipping commit and push');
      }
    } catch (err) {
      // Commit, push, or PR creation failed
      // Note: "nothing to commit" shouldn't occur since we check status before committing,
      // but git could theoretically return an error even with changes present
      logger.error(`Git operation failed: ${err}`);
      throw err;
    }

    logger.info(`Codex provider completed for issue #${issue.number}`);
  } finally {
    // Always clean up the temporary working directory if it was created
    if (repoCwd) {
      logger.info(`Cleaning up temp working directory: ${repoCwd}`);
      await cleanupWorkingDir(repoCwd);
    }
  }
}

/**
 * Handler for codex provider jobs - exported for use in worker
 */
export const codexProviderHandler = processCodex;
