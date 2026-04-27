import { randomUUID } from 'crypto';
import { mkdir, rm, lstat } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { config } from '../config/index.js';

const DEFAULT_GIT_COMMAND_TIMEOUT_MS = 120000;

/**
 * Execute a command and return its exit code
 */
function gitCommandTimeoutMs(timeoutMs?: number): number {
  const parsed = Number(process.env['GIT_COMMAND_TIMEOUT_MS'] ?? timeoutMs ?? DEFAULT_GIT_COMMAND_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GIT_COMMAND_TIMEOUT_MS;
}

export function createGitCommandEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const gitEnv: NodeJS.ProcessEnv = {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
  };
  const token = config.github.token;
  if (!token) {
    return gitEnv;
  }

  const encodedCredentials = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return {
    ...gitEnv,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${encodedCredentials}`,
  };
}

function execCommand(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs?: number
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const commandTimeoutMs = gitCommandTimeoutMs(timeoutMs);
    const child = spawn(file, args, { cwd, env: createGitCommandEnv() });
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const settle = (result: { exitCode: number; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      settle({
        exitCode: 124,
        stderr: `git command timed out after ${commandTimeoutMs}ms${stderr ? `\n${stderr}` : ''}`,
      });
    }, commandTimeoutMs);
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      settle({
        exitCode: timedOut ? 124 : code ?? 1,
        stderr: timedOut ? `git command timed out after ${commandTimeoutMs}ms${stderr ? `\n${stderr}` : ''}` : stderr,
      });
    });
    child.on('error', (err) => {
      settle({ exitCode: 1, stderr: err.message });
    });
  });
}

/**
 * Creates a unique temporary working directory in /tmp
 * @param prefix - Prefix for the directory name
 * @returns The path to the created directory
 */
export async function createTempWorkingDir(prefix: string): Promise<string> {
  if (!prefix || prefix.includes('/') || prefix.includes('\\') || prefix.includes('..')) {
    throw new Error('Invalid prefix: must not contain path separators or ".."');
  }
  const uniqueId = randomUUID();
  const dirPath = `/tmp/${prefix}-${uniqueId}`;

  await mkdir(dirPath, { recursive: true });

  return dirPath;
}

/**
 * Clones the GitHub repository into the specified working directory
 * @param workingDir - The directory to clone into
 * @param remoteUrl - The HTTPS URL of the repository to clone
 */
export async function cloneRepoInto(
  workingDir: string,
  remoteUrl: string,
  timeoutMs?: number
): Promise<void> {
  // Clone directly into the working directory using '.' as the target
  // This avoids creating a subdirectory with the repo name
  const { exitCode, stderr } = await execCommand('git', ['clone', remoteUrl, '.'], workingDir, timeoutMs);

  if (exitCode !== 0) {
    throw new Error(`git clone failed: ${stderr}`);
  }
}

/**
 * Removes a temporary working directory and all its contents
 * @param workingDir - The directory to remove
 */
export async function cleanupWorkingDir(workingDir: string): Promise<void> {
  const resolved = path.resolve(workingDir);
  if (!resolved.startsWith('/tmp/')) {
    throw new Error(`Refusing to delete non-temp directory: ${workingDir}`);
  }
  const stats = await lstat(workingDir);
  if (stats.isSymbolicLink()) {
    throw new Error('Refusing to delete symbolic link');
  }
  await rm(workingDir, { recursive: true, force: true });
}

/**
 * Returns the HTTPS GitHub remote URL without embedding credentials in argv.
 */
export function getRepoRemoteUrl(): string {
  const { owner, repo } = config.github;
  return `https://github.com/${owner}/${repo}.git`;
}
