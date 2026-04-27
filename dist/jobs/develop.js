import * as pty from 'node-pty';
import path from 'node:path';
import { config } from '../config/index.js';
import { ensureNodePtySpawnHelperExecutable } from '../utils/node-pty.js';
import { handleDevelopStopHook, prepareDevelopStopHook } from './develop-stop-hook.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { appendHandoffRecordAndUpdateSummary, readValidatedStageInputRecord, resolveOrchestrationStorageRoot, scheduleNextJob, } from './orchestration.js';
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
function appearsToBeCodexCommand(cliCmd, args) {
    const basename = path.basename(cliCmd);
    return basename === 'codex' || basename === 'codex-cli' || args.some((arg) => arg.includes('codex'));
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
function hasStopHookConfig(args) {
    return args.some((arg, index) => arg.startsWith('hooks.Stop=') || ((args[index - 1] === '--config' || args[index - 1] === '-c') &&
        arg.includes('hooks.Stop')));
}
function addStopHookConfigArgs(args, hookCommand, hookTimeoutSeconds) {
    if (hasStopHookConfig(args)) {
        return args;
    }
    const prompt = args.at(-1);
    if (prompt === undefined) {
        return args;
    }
    const tomlString = (value) => JSON.stringify(value);
    const stopHookConfig = `[{ hooks = [{ type = "command", command = ${tomlString(hookCommand)}, timeout = ${hookTimeoutSeconds}, statusMessage = "Running Quality Gate" }] }]`;
    return [
        ...args.slice(0, -1),
        '--config',
        `hooks.Stop=${stopHookConfig}`,
        prompt,
    ];
}
export function buildCodexCliArgs(cliCmd, cliArgs, prompt, model) {
    const invocationArgs = [...cliArgs];
    const hasExplicitSubcommand = invocationArgs.some((arg) => CODEX_SUBCOMMANDS.has(arg));
    const isCodexCommand = appearsToBeCodexCommand(cliCmd, invocationArgs);
    if (isCodexCommand && !hasExplicitSubcommand) {
        invocationArgs.push('exec');
    }
    if (isCodexCommand && !hasCodexHooksEnabled(invocationArgs)) {
        invocationArgs.push('--enable', 'codex_hooks');
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
function parseMinimumTimeout(value, defaultVal) {
    const parsed = parseInt(value ?? String(defaultVal), 10);
    if (Number.isNaN(parsed) || parsed < 1) {
        return defaultVal;
    }
    return parsed;
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
    stagePayloadSchemas.develop.parse(job.data);
    const inputRecord = await readValidatedStageInputRecord(job.data);
    const planned = stageOutputSchemas.plan.parse(inputRecord.output);
    const { branchName, issue, workspacePath } = planned;
    const codexCliPath = process.env['CODEX_CLI_PATH'] ?? config.codex?.cliPath ?? 'npx @openai/codex';
    const codexModel = process.env['CODEX_MODEL'] ?? config.codex?.model ?? 'gpt-5.4';
    const timeoutMs = parseInt(process.env['CODEX_TIMEOUT_MS'] ?? String(config.codex?.timeoutMs ?? DEFAULT_TIMEOUT_MS), 10);
    const qualityGateCommand = process.env['QUALITY_GATE_TEST_COMMAND'] ?? config.qualityGate?.testCommand;
    const qualityGateTimeoutMs = parseMinimumTimeout(process.env['QUALITY_GATE_TEST_TIMEOUT_MS'], config.qualityGate?.testTimeoutMs ?? 180000);
    logger.info(`Running develop for issue #${issue.number} on branch ${branchName}`);
    const prompt = buildDevelopPrompt(planned);
    const cliParts = codexCliPath.split(/\s+/).filter(Boolean);
    if (cliParts.length === 0) {
        throw new Error('CODEX_CLI_PATH must not be empty');
    }
    const cliCmd = cliParts[0];
    const cliArgs = cliParts.slice(1);
    const stopHook = await prepareDevelopStopHook({
        runId: job.data.runId,
        runDir: job.data.inputRecordRef.runDir,
        workspacePath,
        qualityGateCommand,
        qualityGateTimeoutMs,
    });
    const baseCliArgs = buildCodexCliArgs(cliCmd, cliArgs, prompt, codexModel);
    const finalCliArgs = appearsToBeCodexCommand(cliCmd, cliArgs)
        ? addStopHookConfigArgs(baseCliArgs, stopHook.hookCommand, stopHook.hookTimeoutSeconds)
        : baseCliArgs;
    await ensureNodePtySpawnHelperExecutable(logger);
    const ptyProcess = pty.spawn(cliCmd, finalCliArgs, {
        cwd: workspacePath,
        name: 'xterm-color',
        env: { ...process.env, ...stopHook.env },
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
    let quality = await stopHook.readFinalQualityResult();
    if (!quality) {
        logger.warn('Quality Gate did not produce a Stop-hook result before Codex stopped; running fallback Quality Gate');
        await handleDevelopStopHook({
            statePath: stopHook.statePath,
            runDir: stopHook.runDir,
            workspacePath,
            qualityGateCommand,
            qualityGateTimeoutMs,
            hookInput: {},
        });
        quality = await stopHook.readFinalQualityResult();
        if (!quality) {
            if (!qualityGateCommand?.trim()) {
                throw new Error('Quality Gate did not record misconfiguration before Codex stopped');
            }
            throw new Error('Quality Gate did not produce a Stop-hook result before Codex stopped');
        }
    }
    const terminalStatusByQualityStatus = {
        failed: 'quality-failed',
        'timed-out': 'quality-timed-out',
        misconfigured: 'quality-misconfigured',
    };
    const outputStatus = quality.status === 'passed' ? 'success' : terminalStatusByQualityStatus[quality.status];
    if (!outputStatus) {
        throw new Error(`Unsupported Quality Gate status: ${quality.status}`);
    }
    const output = stageOutputSchemas.develop.parse({
        ...planned,
        status: outputStatus,
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        development: DEVELOPMENT_RESULT,
        quality,
    });
    const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
    const toStage = output.status === 'success' ? 'review' : null;
    const handoffStatus = output.status === 'quality-misconfigured'
        ? 'blocked'
        : output.status === 'success'
            ? 'success'
            : 'failure';
    const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
        runId: job.data.runId,
        fromStage: 'develop',
        toStage,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        dependsOn: job.data.inputRecordRef,
        status: handoffStatus,
        output,
    }, toStage === null ? output.status : undefined);
    return {
        output,
        reviewJobData: toStage === 'review'
            ? createForwardStagePayload(job.data, 'review', inputRecordRef)
            : undefined,
    };
}
export async function runDevelopFlow(job) {
    const logger = createJobLogger(job);
    const result = await runDevelopWork(job, logger);
    if (!result.reviewJobData) {
        logger.info(`Develop stopped after ${result.output.status} for branch: ${result.output.branchName}`);
        return;
    }
    await scheduleNextJob(jobQueue, 'review', result.reviewJobData);
    logger.info(`Review job enqueued for branch: ${result.output.branchName}`);
}
export const processDevelop = runDevelopFlow;
export const developHandler = processDevelop;
