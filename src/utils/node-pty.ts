import { constants as fsConstants } from 'node:fs';
import { access, chmod, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface WarnLogger {
  warn(message: string): void;
}

export function getNodePtySpawnHelperPath(): string | null {
  if (process.platform === 'win32') {
    return null;
  }

  try {
    const packageJsonPath = require.resolve('node-pty/package.json');
    return path.join(
      path.dirname(packageJsonPath),
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper'
    );
  } catch {
    return null;
  }
}

export async function ensureExecutable(filePath: string, logger?: WarnLogger): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return false;
  } catch {
    // Fall through and attempt to add execute permissions.
  }

  try {
    const fileStats = await stat(filePath);
    await chmod(filePath, fileStats.mode | 0o111);
    logger?.warn(`Fixed execute permissions on ${filePath}`);
    return true;
  } catch {
    return false;
  }
}

export async function ensureNodePtySpawnHelperExecutable(logger?: WarnLogger): Promise<void> {
  const helperPath = getNodePtySpawnHelperPath();
  if (!helperPath) {
    return;
  }

  const fixed = await ensureExecutable(helperPath, logger);
  if (!fixed) {
    return;
  }

  try {
    await access(helperPath, fsConstants.X_OK);
  } catch (err) {
    logger?.warn(`node-pty spawn-helper is still not executable at ${helperPath}: ${err}`);
  }
}
