import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureExecutable } from './node-pty.js';

describe('ensureExecutable', () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('adds execute permissions to an existing file', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'node-pty-test-'));
    const filePath = path.join(tempDir, 'spawn-helper');
    await writeFile(filePath, 'echo test\n', 'utf8');
    await chmod(filePath, 0o644);

    const logger = { warn: vi.fn() };
    const changed = await ensureExecutable(filePath, logger);
    const updatedStats = await stat(filePath);

    expect(changed).toBe(true);
    expect(updatedStats.mode & 0o111).not.toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(`Fixed execute permissions on ${filePath}`);
  });

  it('returns false when the file is already executable', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'node-pty-test-'));
    const filePath = path.join(tempDir, 'spawn-helper');
    await writeFile(filePath, 'echo test\n', 'utf8');
    await chmod(filePath, 0o755);

    const logger = { warn: vi.fn() };
    const changed = await ensureExecutable(filePath, logger);

    expect(changed).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
