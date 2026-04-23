import { randomUUID } from 'crypto';
import { mkdir, rm } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from '../config/index.js';

const execAsync = promisify(exec);

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
  // git clone <url> <directory>
  const { stderr } = await execAsync(`git clone "${remoteUrl}" "${workingDir}"`, {
    cwd: workingDir,
  });

  if (stderr) {
    // git clone outputs non-fatal warnings to stderr (e.g., certificate warnings)
    // We only throw on actual errors
    if (stderr.includes('fatal') || stderr.includes('error')) {
      throw new Error(`git clone failed: ${stderr}`);
    }
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
