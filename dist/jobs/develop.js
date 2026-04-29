import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config/index.js';
import { buildCodexSessionArgs, runCodexSession } from './codex-session.js';
import { cleanupSuccessfulQualityArtifacts, handleDevelopStopHook, prepareDevelopStopHook, qualityResultForHandoff, } from './develop-stop-hook.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { resolveDevelopContext } from './context-resolvers.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import { appendHandoffRecordAndUpdateSummary, resolveOrchestrationStorageRoot, scheduleNextJob, } from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
export const DEVELOP_PROMPT_TEMPLATE_PATH = join(process.cwd(), 'prompts', 'develop.md');
const DEVELOPMENT_RESULT = {
    status: 'completed',
    summary: 'Codex completed successfully.',
};
export function buildCodexCliArgs(cliCmd, cliArgs, prompt, model) {
    return buildCodexSessionArgs({
        cliCmd,
        cliArgs,
        prompt,
        model,
        enableHooks: true,
        resumeLastSession: false,
    });
}
function parseMinimumTimeout(value, defaultVal) {
    const parsed = parseInt(value ?? String(defaultVal), 10);
    if (Number.isNaN(parsed) || parsed < 1) {
        return defaultVal;
    }
    return parsed;
}
export async function renderDevelopPrompt(templatePath, input) {
    const template = await readFile(templatePath, 'utf8');
    const replacements = {
        planContent: input.planContent,
    };
    return template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => replacements[key] ?? match);
}
export async function runDevelopWork(job, logger = createJobLogger(job)) {
    stagePayloadSchemas.develop.parse(job.data);
    const context = await resolveDevelopContext(job.data);
    const { branchName, issue, workspacePath } = context.runContext;
    const qualityGateCommand = process.env['QUALITY_GATE_TEST_COMMAND'] ?? config.qualityGate?.testCommand;
    const qualityGateTimeoutMs = parseMinimumTimeout(process.env['QUALITY_GATE_TEST_TIMEOUT_MS'], config.qualityGate?.testTimeoutMs ?? 180000);
    logger.info(`Running develop for issue #${issue.number} on branch ${branchName}`);
    const prompt = await renderDevelopPrompt(DEVELOP_PROMPT_TEMPLATE_PATH, {
        planContent: context.plan.content,
    });
    const stopHook = await prepareDevelopStopHook({
        runId: job.data.runId,
        runDir: job.data.inputRecordRef.runDir,
        workspacePath,
        qualityGateCommand,
        qualityGateTimeoutMs,
    });
    await runCodexSession({
        prompt,
        workspacePath,
        logger,
        resumeLastSession: false,
        enableHooks: true,
        env: stopHook.env,
        logPrefix: 'codex',
        timeoutLabel: 'codex process',
    });
    logger.info('codex process completed successfully');
    let quality = await stopHook.readFinalQualityResult();
    if (!quality) {
        logger.warn('Quality Gate did not produce a Stop-hook result before Codex stopped; running fallback Quality Gate');
        for (let fallbackAttempt = 0; fallbackAttempt < 3 && !quality; fallbackAttempt += 1) {
            const decision = await handleDevelopStopHook({
                statePath: stopHook.statePath,
                runDir: stopHook.runDir,
                workspacePath,
                qualityGateCommand,
                qualityGateTimeoutMs,
                hookInput: {},
            });
            quality = await stopHook.readFinalQualityResult();
            if (decision.decision === 'allow' && !quality) {
                break;
            }
        }
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
    const handoffQuality = qualityResultForHandoff(quality);
    const output = stageOutputSchemas.develop.parse({
        status: outputStatus,
        runId: job.data.runId,
        stageAttempt: job.data.stageAttempt,
        reworkAttempt: job.data.reworkAttempt,
        development: DEVELOPMENT_RESULT,
        quality: handoffQuality,
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
        dependsOn: [job.data.inputRecordRef],
        status: handoffStatus,
        output,
    }, toStage === null ? output.status : undefined);
    try {
        await cleanupSuccessfulQualityArtifacts(stopHook.runDir, quality);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Failed to clean up successful Quality Gate artifacts for run ${job.data.runId}: ${message}`);
    }
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
        logger.info(`Develop stopped after ${result.output.status} for run: ${job.data.runId}`);
        return;
    }
    await scheduleNextJob(jobQueue, 'review', result.reviewJobData);
    logger.info(`Review job enqueued for run: ${job.data.runId}`);
}
export const processDevelop = runDevelopFlow;
export const developHandler = processDevelop;
