import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pty from 'node-pty';
import { parse as parseYaml } from 'yaml';
import { config } from '../config/index.js';
import { ensureNodePtySpawnHelperExecutable } from '../utils/node-pty.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { appendHandoffRecordAndUpdateSummary, readValidatedStageInputRecord, resolveOrchestrationStorageRoot, scheduleNextJob, } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
const DEFAULT_TIMEOUT_MS = 300000;
const MAX_PLAN_ATTEMPTS = 3;
export const PLAN_PROMPT_TEMPLATE_PATH = join(process.cwd(), 'prompts', 'plan.md');
export const PLAN_CHECKS_PATH = join(process.cwd(), 'config', 'plan-checks.yaml');
export const PLAN_CONTINUATION_PROMPT = [
    'Rewrite the full implementation plan and include every required Markdown section title.',
    'Return one complete plan response; do not describe the previous failed attempt.',
].join('\n');
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
function buildPlanCodexArgs(cliCmd, cliArgs, prompt, model, outputPath, resumeLastSession) {
    const invocationArgs = [...cliArgs];
    const hasExplicitSubcommand = invocationArgs.some((arg) => CODEX_SUBCOMMANDS.has(arg));
    const isCodexCommand = appearsToBeCodexCommand(cliCmd, invocationArgs);
    if (isCodexCommand && !hasExplicitSubcommand) {
        invocationArgs.push('exec');
    }
    if (isCodexCommand && resumeLastSession && invocationArgs.includes('exec') && !invocationArgs.includes('resume')) {
        invocationArgs.push('resume', '--last');
    }
    if (!invocationArgs.includes('--dangerously-bypass-approvals-and-sandbox')) {
        invocationArgs.push('--dangerously-bypass-approvals-and-sandbox');
    }
    if (model && !hasExplicitModelArg(invocationArgs)) {
        invocationArgs.push('--model', model);
    }
    if (isCodexCommand && !hasOutputLastMessageArg(invocationArgs)) {
        invocationArgs.push('--output-last-message', outputPath);
    }
    invocationArgs.push(prompt);
    return invocationArgs;
}
function stripAnsi(value) {
    const ansiPattern = new RegExp(String.raw `\x1B\[[0-9;?]*[ -/]*[@-~]`, 'g');
    return value.replace(ansiPattern, '').trim();
}
async function runCodexOnce(prompt, workspacePath, logger, resumeLastSession) {
    const codexCliPath = process.env['CODEX_CLI_PATH'] ?? config.codex?.cliPath ?? 'npx @openai/codex';
    const codexModel = process.env['CODEX_MODEL'] ?? config.codex?.model ?? 'gpt-5.4';
    const timeoutMs = parseInt(process.env['CODEX_TIMEOUT_MS'] ?? String(config.codex?.timeoutMs ?? DEFAULT_TIMEOUT_MS), 10);
    const cliParts = codexCliPath.split(/\s+/).filter(Boolean);
    if (cliParts.length === 0) {
        throw new Error('CODEX_CLI_PATH must not be empty');
    }
    const cliCmd = cliParts[0];
    const outputDir = await mkdtemp(join(tmpdir(), 'plan-codex-'));
    const outputPath = join(outputDir, 'last-message.md');
    const cliArgs = buildPlanCodexArgs(cliCmd, cliParts.slice(1), prompt, codexModel, outputPath, resumeLastSession);
    await ensureNodePtySpawnHelperExecutable(logger);
    const ptyProcess = pty.spawn(cliCmd, cliArgs, {
        cwd: workspacePath,
        name: 'xterm-color',
        env: { ...process.env },
    });
    let captured = '';
    logger.info(`plan codex command: ${cliCmd} ${cliParts.slice(1).join(' ')}`.trim());
    ptyProcess.onData((data) => {
        captured += data;
        const line = data.toString().trim();
        if (line) {
            logger.info(`[plan-codex] ${line}`);
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
            settle(() => reject(new Error(`plan codex process timed out after ${timeoutMs}ms`)));
        }, timeoutMs);
        ptyProcess.onExit(({ exitCode }) => {
            clearTimeout(timer);
            settle(() => resolve(exitCode));
        });
    });
    if (exitCode !== 0) {
        await rm(outputDir, { recursive: true, force: true });
        throw new Error(`plan codex process failed with exit code ${exitCode}`);
    }
    try {
        const finalMessage = await readFile(outputPath, 'utf8');
        return finalMessage.trim() || stripAnsi(captured);
    }
    catch {
        return stripAnsi(captured);
    }
    finally {
        await rm(outputDir, { recursive: true, force: true });
    }
}
async function createDefaultPlanningSession(input) {
    let hasStartedSession = false;
    return {
        async send(prompt) {
            const response = await runCodexOnce(prompt, input.workspacePath, input.logger, hasStartedSession);
            hasStartedSession = true;
            return response;
        },
    };
}
export async function renderPlanPrompt(templatePath, input) {
    const template = await readFile(templatePath, 'utf8');
    const replacements = {
        issueNumber: String(input.issue.number),
        issueTitle: input.issue.title,
        issueDescription: input.issue.body?.trim() ? input.issue.body : '(No description provided)',
    };
    return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => replacements[key] ?? match);
}
export async function loadPlanChecks(checksPath) {
    const raw = await readFile(checksPath, 'utf8');
    let parsed;
    try {
        parsed = parseYaml(raw);
    }
    catch (err) {
        throw new Error(`Failed to parse Plan checks YAML: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Plan checks YAML must be an object');
    }
    const requiredTitles = parsed.requiredTitles;
    if (!Array.isArray(requiredTitles) || requiredTitles.length === 0) {
        throw new Error('requiredTitles must be a non-empty array');
    }
    if (!requiredTitles.every((title) => typeof title === 'string' && title.trim().length > 0)) {
        throw new Error('requiredTitles must contain only non-empty strings');
    }
    return { requiredTitles: requiredTitles.map((title) => title.trim()) };
}
export function validatePlanResponse(content, checks) {
    const headings = new Set(content
        .split(/\r?\n/)
        .map((line) => line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1]?.trim().toLowerCase())
        .filter((heading) => Boolean(heading)));
    const missingTitles = checks.requiredTitles.filter((title) => !headings.has(title.trim().toLowerCase()));
    if (missingTitles.length === 0) {
        return { passed: true, missingTitles: [] };
    }
    return {
        passed: false,
        missingTitles,
        failureReason: `Missing required plan section titles: ${missingTitles.join(', ')}`,
    };
}
export async function runPlanWork(job, options = {}) {
    stagePayloadSchemas.plan.parse(job.data);
    const inputRecord = await readValidatedStageInputRecord(job.data);
    const assessed = stageOutputSchemas.assess.parse(inputRecord.output);
    const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
    const logger = createJobLogger(job);
    const checks = await loadPlanChecks(options.checksPath ?? PLAN_CHECKS_PATH);
    const initialPrompt = await renderPlanPrompt(options.promptTemplatePath ?? PLAN_PROMPT_TEMPLATE_PATH, {
        issue: assessed.issue,
    });
    const session = await (options.createPlanningSession ?? createDefaultPlanningSession)({
        workspacePath: assessed.workspacePath,
        logger,
    });
    let dependsOn = job.data.inputRecordRef;
    let latestOutput;
    try {
        for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt += 1) {
            const prompt = attempt === 1 ? initialPrompt : PLAN_CONTINUATION_PROMPT;
            const content = await session.send(prompt);
            const validation = validatePlanResponse(content, checks);
            const isFinalAttempt = attempt === MAX_PLAN_ATTEMPTS;
            const output = stageOutputSchemas.plan.parse({
                ...assessed,
                status: validation.passed ? 'success' : 'validation-failed',
                runId: job.data.runId,
                stageAttempt: job.data.stageAttempt,
                reworkAttempt: job.data.reworkAttempt,
                plan: validation.passed
                    ? {
                        status: 'success',
                        summary: 'Plan validated successfully.',
                        content,
                    }
                    : {
                        status: 'validation-failed',
                        summary: 'Plan validation failed.',
                        content,
                        failureReason: validation.failureReason,
                    },
            });
            latestOutput = output;
            if (validation.passed) {
                const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
                    runId: job.data.runId,
                    fromStage: 'plan',
                    toStage: 'develop',
                    stageAttempt: job.data.stageAttempt,
                    reworkAttempt: job.data.reworkAttempt,
                    dependsOn,
                    status: 'success',
                    output,
                });
                return {
                    output,
                    developJobData: createForwardStagePayload(job.data, 'develop', inputRecordRef),
                };
            }
            const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
                runId: job.data.runId,
                fromStage: 'plan',
                toStage: isFinalAttempt ? null : 'plan',
                stageAttempt: job.data.stageAttempt,
                reworkAttempt: job.data.reworkAttempt,
                dependsOn,
                status: isFinalAttempt ? 'blocked' : 'rework-needed',
                output,
            }, isFinalAttempt ? 'blocked' : undefined);
            dependsOn = inputRecordRef;
            if (isFinalAttempt) {
                return { output };
            }
        }
    }
    finally {
        await session.close?.();
    }
    if (!latestOutput) {
        throw new Error('Plan did not produce output');
    }
    return { output: latestOutput };
}
export async function runPlanFlow(job, options = {}) {
    const logger = createJobLogger(job);
    const result = await runPlanWork(job, options);
    if (!result.developJobData) {
        logger.info(`Planning stopped after ${result.output.status} for branch: ${result.output.branchName}`);
        return;
    }
    const developJobData = result.developJobData;
    const outputRecord = await readValidatedStageInputRecord(developJobData);
    const output = stageOutputSchemas.plan.parse(outputRecord.output);
    logger.info(`Planning issue #${output.issue.number} on branch ${output.branchName}`);
    await scheduleNextJob(jobQueue, 'develop', developJobData);
    logger.info(`Develop job enqueued for branch: ${output.branchName}`);
}
export const processPlan = runPlanFlow;
export const planHandler = processPlan;
