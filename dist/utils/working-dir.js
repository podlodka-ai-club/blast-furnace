import { randomUUID } from 'crypto';
import { mkdir, rm, lstat } from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { config } from '../config/index.js';
function execCommand(file, args, cwd) {
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
export async function createTempWorkingDir(prefix) {
    if (!prefix || prefix.includes('/') || prefix.includes('\\') || prefix.includes('..')) {
        throw new Error('Invalid prefix: must not contain path separators or ".."');
    }
    const uniqueId = randomUUID();
    const dirPath = `/tmp/${prefix}-${uniqueId}`;
    await mkdir(dirPath, { recursive: true });
    return dirPath;
}
export async function cloneRepoInto(workingDir, remoteUrl) {
    const { exitCode, stderr } = await execCommand('git', ['clone', remoteUrl, '.'], workingDir);
    if (exitCode !== 0) {
        throw new Error(`git clone failed: ${stderr}`);
    }
}
export async function cleanupWorkingDir(workingDir) {
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
export function getRepoRemoteUrl() {
    const { owner, repo, token } = config.github;
    return `https://${token}@github.com/${owner}/${repo}.git`;
}
