import { randomUUID } from 'crypto';
import { mkdir, rm } from 'fs/promises';
import { spawn } from 'child_process';
import { config } from '../config/index.js';

/**
 * Execute a command and return its exit code
 */
function execCommand(file: string, args: string[], cwd: string): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd });
    let stderr = '';
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stderr });
    });
    child.on('error', (err) => {
      resolve({ exitCode: 1, stderr: err.message });
    });
  });
}

/**
 * Creates a unique temporary working directory in /tmp
 * @param prefix - Prefix for the directory name
 * @returns The path to the created directory
 */
export async function createTempWorkingDir(prefix: string): Promise<string> {
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
export async function cloneRepoInto(workingDir: string, remoteUrl: string): Promise<void> {
  // Clone directly into the working directory using '.' as the target
  // This avoids creating a subdirectory with the repo name
  const { exitCode, stderr } = await execCommand('git', ['clone', remoteUrl, '.'], workingDir);

  if (exitCode !== 0) {
    throw new Error(`git clone failed: ${stderr}`);
  }
}

/**
 * Removes a temporary working directory and all its contents
 * @param workingDir - The directory to remove
 */
export async function cleanupWorkingDir(workingDir: string): Promise<void> {
  await rm(workingDir, { recursive: true, force: true });
}

/**
 * Returns the HTTPS GitHub remote URL with token authentication
 * Uses the configured GitHub owner, repo, and token
 */
export function getRepoRemoteUrl(): string {
  const { owner, repo, token } = config.github;
  // Use HTTPS with token for authentication
  return `https://${token}@github.com/${owner}/${repo}.git`;
}
