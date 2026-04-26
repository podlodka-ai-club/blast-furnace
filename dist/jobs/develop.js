import * as pty from 'node-pty';
import path from 'node:path';
import { config } from '../config/index.js';
import { ensureNodePtySpawnHelperExecutable } from '../utils/node-pty.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { scheduleNextJob } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
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
const DEVELOPMENT_RESULT = {
    status: 'completed',
    summary: 'Codex completed successfully.',
};
function hasExplicitModelArg(args) {
    return args.some((arg, index) => {
        if (arg === '-m' || arg === '--model')
            return true;
        if (arg.startsWith('--model='))
            return true;
        return arg === '-c' && args[index + 1]?.startsWith('model=');
    });
}
function buildCodexCliArgs(cliCmd, cliArgs, prompt, model) {
    const invocationArgs = [...cliArgs];
    const hasExplicitSubcommand = invocationArgs.some((arg) => CODEX_SUBCOMMANDS.has(arg));
    const basename = path.basename(cliCmd);
    const appearsToBeCodexCommand = basename === 'codex' || basename === 'codex-cli' || invocationArgs.some((arg) => arg.includes('codex'));
    if (appearsToBeCodexCommand && !hasExplicitSubcommand) {
        invocationArgs.push('exec');
    }
    if (!invocationArgs.includes('--dangerously-bypass-approvals-and-sandbox')) {
        invocationArgs.push('--dangerously-bypass-approvals-and-sandbox');
    }
    if (model && !hasExplicitModelArg(invocationArgs)) {
        invocationArgs.push('--model', model);
    }
    invocationArgs.push(prompt);
    return invocationArgs;
}
function buildDevelopPrompt(data) {
    return [
        `Issue #${data.issue.number}: ${data.issue.title}`,
        '',
        data.issue.body ?? '(No description provided)',
        '',
        'Plan context:',
        JSON.stringify(data.plan, null, 2),
    ].join('\n');
}
export async function runDevelopWork(job, logger = createJobLogger(job)) {
    const { branchName, issue, workspacePath } = job.data;
    const codexCliPath = process.env['CODEX_CLI_PATH'] ?? config.codex?.cliPath ?? 'npx @openai/codex';
    const codexModel = process.env['CODEX_MODEL'] ?? config.codex?.model ?? 'gpt-5.4';
    const timeoutMs = parseInt(process.env['CODEX_TIMEOUT_MS'] ?? String(config.codex?.timeoutMs ?? DEFAULT_TIMEOUT_MS), 10);
    logger.info(`Running develop for issue #${issue.number} on branch ${branchName}`);
    const prompt = buildDevelopPrompt(job.data);
    const cliParts = codexCliPath.split(/\s+/).filter(Boolean);
    if (cliParts.length === 0) {
        throw new Error('CODEX_CLI_PATH must not be empty');
    }
    const cliCmd = cliParts[0];
    const cliArgs = cliParts.slice(1);
    const finalCliArgs = buildCodexCliArgs(cliCmd, cliArgs, prompt, codexModel);
    await ensureNodePtySpawnHelperExecutable(logger);
    const ptyProcess = pty.spawn(cliCmd, finalCliArgs, {
        cwd: workspacePath,
        name: 'xterm-color',
        env: { ...process.env },
    });
    logger.info(`codex command: ${cliCmd} ${cliArgs.join(' ')}`.trim());
    ptyProcess.onData((data) => {
        const line = data.toString().trim();
        if (line) {
            logger.info(`[codex] ${line}`);
        }
    });
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
            settle(() => reject(new Error(`codex process timed out after ${timeoutMs}ms`)));
        }, timeoutMs);
        ptyProcess.onExit(({ exitCode }) => {
            clearTimeout(timer);
            settle(() => resolve(exitCode));
        });
    });
    if (exitCode !== 0) {
        logger.error(`codex process exited with code ${exitCode}`);
        throw new Error(`codex process failed with exit code ${exitCode}`);
    }
    logger.info('codex process completed successfully');
    return createForwardStagePayload(job.data, 'quality-gate', {
        development: DEVELOPMENT_RESULT,
    });
}
export async function runDevelopFlow(job) {
    const logger = createJobLogger(job);
    const qualityGateJobData = await runDevelopWork(job, logger);
    await scheduleNextJob(jobQueue, 'quality-gate', qualityGateJobData);
    logger.info(`Quality gate job enqueued for branch: ${qualityGateJobData.branchName}`);
}
export const processDevelop = runDevelopFlow;
export const developHandler = processDevelop;
