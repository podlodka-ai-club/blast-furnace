import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pty from 'node-pty';
import { config } from '../config/index.js';
import { ensureNodePtySpawnHelperExecutable } from '../utils/node-pty.js';
const DEFAULT_TIMEOUT_MS = 300000;
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
function hasExplicitModelArg(args) {
    return args.some((arg, index) => {
        if (arg === '-m' || arg === '--model')
            return true;
        if (arg.startsWith('--model='))
            return true;
        return arg === '-c' && args[index + 1]?.startsWith('model=');
    });
}
function appearsToBeCodexCommand(cliCmd, args) {
    const basename = cliCmd.split('/').at(-1) ?? cliCmd;
    return basename === 'codex' || basename === 'codex-cli' || args.some((arg) => arg.includes('codex'));
}
function hasOutputLastMessageArg(args) {
    return args.some((arg, index) => arg === '--output-last-message' || arg === '-o' || args[index - 1] === '-o');
}
function hasCodexHooksEnabled(args) {
    return args.some((arg, index) => {
        if (arg === 'codex_hooks') {
            return args[index - 1] === '--enable';
        }
        if (arg === '--enable=codex_hooks')
            return true;
        return arg === '--enable' && args[index + 1] === 'codex_hooks';
    });
}
function hasSandboxArg(args) {
    return args.some((arg, index) => arg === '--sandbox' || arg.startsWith('--sandbox=') || args[index - 1] === '--sandbox');
}
export function buildCodexSessionArgs(options) {
    const invocationArgs = [...options.cliArgs];
    const hasExplicitSubcommand = invocationArgs.some((arg) => CODEX_SUBCOMMANDS.has(arg));
    const isCodexCommand = appearsToBeCodexCommand(options.cliCmd, invocationArgs);
    if (isCodexCommand && !hasExplicitSubcommand) {
        invocationArgs.push('exec');
    }
    if (isCodexCommand
        && options.codexExecSubcommand
        && invocationArgs.includes('exec')
        && !invocationArgs.includes(options.codexExecSubcommand)) {
        invocationArgs.splice(invocationArgs.indexOf('exec') + 1, 0, options.codexExecSubcommand);
    }
    if (isCodexCommand
        && options.resumeLastSession
        && invocationArgs.includes('exec')
        && !invocationArgs.includes('resume')) {
        invocationArgs.push('resume', '--last');
    }
    if (isCodexCommand && options.enableHooks && !hasCodexHooksEnabled(invocationArgs)) {
        invocationArgs.push('--enable', 'codex_hooks');
    }
    const shouldBypassSandbox = options.bypassSandbox ?? true;
    if (shouldBypassSandbox && !invocationArgs.includes('--dangerously-bypass-approvals-and-sandbox')) {
        invocationArgs.push('--dangerously-bypass-approvals-and-sandbox');
    }
    if (isCodexCommand && options.sandboxMode && !shouldBypassSandbox && !hasSandboxArg(invocationArgs)) {
        invocationArgs.push('--sandbox', options.sandboxMode);
    }
    if (options.model && !hasExplicitModelArg(invocationArgs)) {
        invocationArgs.push('--model', options.model);
    }
    if (isCodexCommand && options.outputLastMessagePath && !hasOutputLastMessageArg(invocationArgs)) {
        invocationArgs.push('--output-last-message', options.outputLastMessagePath);
    }
    invocationArgs.push(options.prompt);
    return invocationArgs;
}
export function stripAnsi(value) {
    const ansiPattern = new RegExp(String.raw `\x1B\[[0-9;?]*[ -/]*[@-~]`, 'g');
    return value.replace(ansiPattern, '').trim();
}
export async function runCodexSession(options) {
    const codexCliPath = process.env['CODEX_CLI_PATH'] ?? config.codex?.cliPath ?? 'npx @openai/codex';
    const codexModel = process.env['CODEX_MODEL'] ?? config.codex?.model ?? 'gpt-5.4';
    const timeoutMs = parseInt(process.env['CODEX_TIMEOUT_MS'] ?? String(config.codex?.timeoutMs ?? DEFAULT_TIMEOUT_MS), 10);
    const cliParts = codexCliPath.split(/\s+/).filter(Boolean);
    if (cliParts.length === 0) {
        throw new Error('CODEX_CLI_PATH must not be empty');
    }
    const cliCmd = cliParts[0];
    const outputDir = options.outputLastMessage ? await mkdtemp(join(tmpdir(), 'codex-session-')) : undefined;
    const outputPath = outputDir ? join(outputDir, 'last-message.md') : undefined;
    const cliArgs = buildCodexSessionArgs({
        cliCmd,
        cliArgs: cliParts.slice(1),
        prompt: options.prompt,
        model: codexModel,
        resumeLastSession: options.resumeLastSession,
        outputLastMessagePath: outputPath,
        enableHooks: options.enableHooks,
        bypassSandbox: options.bypassSandbox,
        sandboxMode: options.sandboxMode,
        codexExecSubcommand: options.codexExecSubcommand,
    });
    await ensureNodePtySpawnHelperExecutable(options.logger);
    const ptyProcess = pty.spawn(cliCmd, cliArgs, {
        cwd: options.workspacePath,
        name: 'xterm-color',
        env: { ...process.env, ...options.env },
    });
    let captured = '';
    options.logger.info(`${options.logPrefix} command: ${cliCmd} ${cliParts.slice(1).join(' ')}`.trim());
    ptyProcess.onData((data) => {
        captured += data;
        const line = data.toString().trim();
        if (line) {
            options.logger.info(`[${options.logPrefix}] ${line}`);
        }
    });
    try {
        const exitCode = await new Promise((resolve, reject) => {
            let settled = false;
            const settle = (fn) => {
                if (!settled) {
                    settled = true;
                    fn();
                }
            };
            const timer = setTimeout(() => {
                ptyProcess.kill('SIGTERM');
                settle(() => reject(new Error(`${options.timeoutLabel} timed out after ${timeoutMs}ms`)));
            }, timeoutMs);
            ptyProcess.onExit(({ exitCode }) => {
                clearTimeout(timer);
                settle(() => resolve(exitCode));
            });
        });
        if (exitCode !== 0) {
            throw new Error(`${options.timeoutLabel} failed with exit code ${exitCode}`);
        }
        if (!outputPath) {
            return { cliCmd, cliArgs, output: stripAnsi(captured) };
        }
        try {
            const finalMessage = await readFile(outputPath, 'utf8');
            return { cliCmd, cliArgs, output: finalMessage.trim() || stripAnsi(captured) };
        }
        catch {
            return { cliCmd, cliArgs, output: stripAnsi(captured) };
        }
    }
    finally {
        if (outputDir) {
            await rm(outputDir, { recursive: true, force: true });
        }
    }
}
