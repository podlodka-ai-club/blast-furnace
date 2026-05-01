import { spawn } from 'child_process';
import type { Job } from 'bullmq';
import type {
  MakePrJobData,
  MakePrOutput,
  NoChangeOutput,
  PrReworkIntakeOutput,
  PullRequestCreationFailureOutput,
  PullRequestIdentity,
  PullRequestOutput,
  SyncTrackerStateJobData,
} from '../types/index.js';
import { createPullRequest, getPullRequestState } from '../github/pullRequests.js';
import { assertConfiguredRepository } from '../github/repository.js';
import { cleanupWorkingDir, createGitCommandEnv, getRepoRemoteUrl } from '../utils/working-dir.js';
import { stageOutputSchemas, stagePayloadSchemas } from './handoff-contracts.js';
import { resolveMakePrContext } from './context-resolvers.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
  readHandoffRecords,
  resolveOrchestrationStorageRoot,
  scheduleNextJob,
} from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';
import { statusItem, updateRunStatus } from './status.js';

const TARGET_REPO_PATHS = [
  '.',
  ':(exclude).orchestrator',
  ':(exclude).orchestrator/**',
  ':(exclude).codex',
  ':(exclude).codex/**',
];

function execGitCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: createGitCommandEnv() });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`git command failed: ${stderr}`));
      }
    });

    child.on('error', reject);
  });
}

async function pushWithRetry(
  remoteUrl: string,
  branchName: string,
  cwd: string,
  logger: ReturnType<typeof createJobLogger>,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await execGitCommand(['push', remoteUrl, branchName], cwd);
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('non-fast-forward')
        || message.includes('current branch is behind')
        || message.includes('Updates were rejected')
      ) {
        await execGitCommand(['fetch', remoteUrl, `heads/${branchName}`], cwd);
      }
      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.warn(`Push attempt ${attempt} failed for ${branchName}: ${err}, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export type MakePrWorkResult =
  | { status: 'no-changes'; output: NoChangeOutput; workspacePath: string; syncTrackerStateJobData?: SyncTrackerStateJobData }
  | { status: PullRequestCreationFailureOutput['status']; output: PullRequestCreationFailureOutput }
  | {
    status: 'pull-request-created';
    output: PullRequestOutput;
    syncTrackerStateJobData: SyncTrackerStateJobData;
  };

type PullRequestCreationFailureStatus = PullRequestCreationFailureOutput['status'];

interface PullRequestFailureClassification {
  status: PullRequestCreationFailureStatus;
  errorMessage: string;
}

interface ReworkPullRequestContext {
  pullRequest: PullRequestIdentity;
  head: {
    owner: string;
    repo: string;
    branch: string;
    sha: string;
  };
}

function prReworkContext(output: unknown): ReworkPullRequestContext | null {
  if (
    typeof output === 'object'
    && output !== null
    && 'status' in output
    && output.status === 'rework-needed'
    && 'pullRequest' in output
    && typeof output.pullRequest === 'object'
    && output.pullRequest !== null
    && 'number' in output.pullRequest
    && 'htmlUrl' in output.pullRequest
    && 'pullRequestHead' in output
    && typeof output.pullRequestHead === 'object'
    && output.pullRequestHead !== null
  ) {
    const parsed = output as PrReworkIntakeOutput;
    if (parsed.status !== 'rework-needed') {
      return null;
    }
    return {
      pullRequest: {
        number: parsed.pullRequest.number,
        htmlUrl: parsed.pullRequest.htmlUrl,
      },
      head: parsed.pullRequestHead,
    };
  }
  return null;
}

async function resolveReworkPullRequest(job: Job<MakePrJobData>): Promise<ReworkPullRequestContext | null> {
  if (job.data.reworkAttempt === 0) return null;
  const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
  for (const record of [...records].reverse()) {
    if (record.fromStage !== 'pr-rework-intake') continue;
    const context = prReworkContext(record.output);
    if (context) return context;
  }
  throw new Error('Rework pull request context not found');
}

async function validateCurrentReworkPullRequest(context: ReworkPullRequestContext): Promise<void> {
  const current = await getPullRequestState(context.pullRequest.number);
  if (current.head.owner !== context.head.owner || current.head.repo !== context.head.repo) {
    throw new Error('Rework pull request head repository mismatch');
  }
  if (current.head.branch !== context.head.branch) {
    throw new Error('Rework pull request head branch mismatch');
  }
  if (current.head.sha !== context.head.sha) {
    throw new Error('Rework pull request head SHA mismatch');
  }
}

function sanitizeForGit(text: string, maxLength = 200): string {
  return text.replace(/[\r\n]/g, ' ').slice(0, maxLength);
}

function parseGitStatusPaths(status: string): string[] {
  const paths = new Set<string>();
  for (const line of status.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const statusCode = line.slice(0, 2);
    const rawPath = (line[2] === ' ' ? line.slice(3) : line.slice(2).trimStart()).trim();
    if (!rawPath) continue;

    if ((statusCode.includes('R') || statusCode.includes('C')) && rawPath.includes(' -> ')) {
      const [fromPath, toPath] = rawPath.split(' -> ');
      if (fromPath) paths.add(fromPath);
      if (toPath) paths.add(toPath);
      continue;
    }

    paths.add(rawPath);
  }
  return [...paths];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function boundedErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return boundedErrorMessage(error.message);
  }
  if (typeof error === 'string') {
    return boundedErrorMessage(error);
  }
  return 'Unknown pull request creation error';
}

function githubErrorMessages(error: unknown): string[] {
  const messages = new Set<string>();
  if (!isObject(error)) {
    if (error instanceof Error && error.message) {
      messages.add(error.message);
    }
    return [...messages];
  }
  const response = isObject(error.response) ? error.response : undefined;
  const data = response && isObject(response.data) ? response.data : undefined;
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  for (const entry of errors) {
    if (isObject(entry) && typeof entry.message === 'string') {
      messages.add(entry.message);
    }
  }
  if (typeof data?.message === 'string') {
    messages.add(data.message);
  }
  if (error instanceof Error && error.message) {
    messages.add(error.message);
  }
  return [...messages];
}

function isPullRequestAlreadyExistsError(error: unknown): boolean {
  const status = isObject(error) && typeof error.status === 'number' ? error.status : undefined;
  const responseStatus = isObject(error) && isObject(error.response) && typeof error.response.status === 'number'
    ? error.response.status
    : undefined;
  const httpStatus = status ?? responseStatus;
  if (httpStatus !== undefined && httpStatus !== 422) {
    return false;
  }
  return githubErrorMessages(error).some((message) => message.includes('A pull request already exists'));
}

function classifyPullRequestCreationError(error: unknown): PullRequestFailureClassification {
  if (isPullRequestAlreadyExistsError(error)) {
    const duplicateMessage = githubErrorMessages(error).find((message) => (
      message.includes('A pull request already exists')
    ));
    return {
      status: 'pull-request-already-exists',
      errorMessage: boundedErrorMessage(duplicateMessage ?? errorMessage(error)),
    };
  }
  return {
    status: 'pull-request-creation-failed',
    errorMessage: errorMessage(error),
  };
}

async function recordPullRequestCreationFailure(
  orchestrationRoot: string,
  job: Job<MakePrJobData>,
  context: Awaited<ReturnType<typeof resolveMakePrContext>>,
  failure: PullRequestFailureClassification,
  logger: ReturnType<typeof createJobLogger>
): Promise<MakePrWorkResult> {
  const output = stageOutputSchemas['make-pr'].parse({
    status: failure.status,
    errorMessage: failure.errorMessage,
    runId: job.data.runId,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
  }) as MakePrOutput;
  if (output.status !== 'pull-request-already-exists' && output.status !== 'pull-request-creation-failed') {
    throw new Error('Expected pull request creation failure make-pr output');
  }

  await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
    runId: job.data.runId,
    fromStage: 'make-pr',
    toStage: null,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: [
      job.data.inputRecordRef,
      context.developRecord.recordId,
      context.planRecord.recordId,
    ],
    status: 'failure',
    output,
  }, failure.status);

  const isDuplicate = failure.status === 'pull-request-already-exists';
  await updateRunStatus(orchestrationRoot, job.data.runId, {
    heading: isDuplicate
      ? 'Blast Furnace found an existing pull request'
      : 'Blast Furnace could not create a pull request',
    focus: isDuplicate
      ? 'Final state: Pull request already exists'
      : 'Final state: Pull request creation failed',
    note: failure.errorMessage,
    items: [
      statusItem(
        'draft-pr-and-in-review',
        1,
        'failed',
        'Make PR',
        isDuplicate ? 'A pull request already exists' : 'PR creation failed'
      ),
    ],
  }, logger);

  return { status: output.status, output };
}

export async function runMakePrWork(
  job: Job<MakePrJobData>,
  logger = createJobLogger(job)
): Promise<MakePrWorkResult> {
  stagePayloadSchemas['make-pr'].parse(job.data);
  const context = await resolveMakePrContext(job.data);
  const { issue, repository, branchName, workspacePath } = context.runContext;
  assertConfiguredRepository(repository);

  logger.info(`Finalizing issue #${issue.number} on branch ${branchName}`);

  const orchestrationRoot = resolveOrchestrationStorageRoot(job.data.inputRecordRef);
  const reworkPullRequest = await resolveReworkPullRequest(job);
  if (reworkPullRequest) {
    await validateCurrentReworkPullRequest(reworkPullRequest);
  }
  await updateRunStatus(orchestrationRoot, job.data.runId, {
    heading: 'Blast Furnace is creating a pull request',
    focus: 'Current focus: Make PR',
    items: [statusItem('draft-pr-and-in-review', 1, 'in-progress', 'Make PR', 'In progress')],
  }, logger);
  const status = await execGitCommand(
    ['status', '--porcelain', '--untracked-files=all', '--', ...TARGET_REPO_PATHS],
    workspacePath
  );

  if (!status) {
    logger.info(reworkPullRequest
      ? 'No changes detected during rework, handing off to tracker synchronization'
      : 'No changes detected, skipping commit, push, pull request, and tracker synchronization');
    const output = stageOutputSchemas['make-pr'].parse({
      status: 'no-changes',
      runId: job.data.runId,
      stageAttempt: job.data.stageAttempt,
      reworkAttempt: job.data.reworkAttempt,
      ...(reworkPullRequest ? { pullRequest: reworkPullRequest.pullRequest } : {}),
    }) as MakePrOutput;
    if (output.status !== 'no-changes') {
      throw new Error('Expected no-changes make-pr output');
    }
    const toStage = reworkPullRequest ? 'sync-tracker-state' : null;
    await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
      runId: job.data.runId,
      fromStage: 'make-pr',
      toStage,
      stageAttempt: job.data.stageAttempt,
      reworkAttempt: job.data.reworkAttempt,
      dependsOn: [
        job.data.inputRecordRef,
        context.developRecord.recordId,
        context.planRecord.recordId,
      ],
      status: 'success',
      output,
    }, reworkPullRequest ? undefined : 'completed');
    await updateRunStatus(orchestrationRoot, job.data.runId, {
      heading: 'Blast Furnace finished with no changes',
      focus: 'Final state: No repository changes',
      items: [statusItem('draft-pr-and-in-review', 1, 'skipped', 'Make PR', 'No changes')],
    }, logger);
    if (reworkPullRequest) {
      const records = await readHandoffRecords(job.data.inputRecordRef.handoffPath);
      const record = records.at(-1);
      if (!record) throw new Error('Make PR handoff record not found');
      return {
        status: 'no-changes',
        output,
        workspacePath,
        syncTrackerStateJobData: createForwardStagePayload(job.data, 'sync-tracker-state', {
          runDir: job.data.inputRecordRef.runDir,
          handoffPath: job.data.inputRecordRef.handoffPath,
          recordId: record.recordId,
          sequence: record.sequence,
          stage: 'make-pr',
        }, job.data.stageAttempt) as SyncTrackerStateJobData,
      };
    }
    return { status: 'no-changes', output, workspacePath };
  }

  logger.info('Changes detected, committing...');
  const changedPaths = parseGitStatusPaths(status);
  if (changedPaths.length === 0) {
    throw new Error('Detected git status output but could not parse changed target paths');
  }
  await execGitCommand(['add', '-A', '--', ...changedPaths], workspacePath);

  const sanitizedTitle = sanitizeForGit(issue.title);
  const commitResult = await execGitCommand(
    ['commit', '-m', `Processed issue #${issue.number} via codex: ${sanitizedTitle}`],
    workspacePath
  );
  logger.info(`Changes committed: ${commitResult}`);

  logger.info('Pushing changes to remote branch...');
  await pushWithRetry(getRepoRemoteUrl(), branchName, workspacePath, logger);
  logger.info(`Changes pushed to ${branchName}`);

  let prResult: Awaited<ReturnType<typeof createPullRequest>>;
  if (reworkPullRequest) {
    prResult = reworkPullRequest.pullRequest;
  } else {
    logger.info('Creating pull request...');
    try {
      prResult = await createPullRequest({
        title: `Process issue #${issue.number}: ${sanitizedTitle}`,
        head: branchName,
        base: 'main',
        body: `Closes #${issue.number}`,
      });
    } catch (err) {
      const failure = classifyPullRequestCreationError(err);
      logger.error(`Pull request creation failed with ${failure.status}: ${failure.errorMessage}`);
      return recordPullRequestCreationFailure(orchestrationRoot, job, context, failure, logger);
    }
  }
  logger.info(`Pull request created: ${prResult.htmlUrl}`);

  const output = stageOutputSchemas['make-pr'].parse({
    status: 'pull-request-created',
    pullRequest: prResult,
    runId: job.data.runId,
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
  }) as MakePrOutput;
  if (output.status !== 'pull-request-created') {
    throw new Error('Expected pull-request-created make-pr output');
  }
  const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
    runId: job.data.runId,
    fromStage: 'make-pr',
    toStage: 'sync-tracker-state',
    stageAttempt: job.data.stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: [
      job.data.inputRecordRef,
      context.developRecord.recordId,
      context.planRecord.recordId,
    ],
    status: 'success',
    output,
  });
  await updateRunStatus(orchestrationRoot, job.data.runId, {
    heading: 'Blast Furnace created a pull request',
    focus: `Result: Pull request #${output.pullRequest.number} created`,
    items: [
      statusItem(
        'draft-pr-and-in-review',
        1,
        'completed',
        'Make PR',
        `PR #${output.pullRequest.number} created`
      ),
    ],
  }, logger);

  return {
    status: 'pull-request-created',
    output,
    syncTrackerStateJobData: createForwardStagePayload(
      job.data,
      'sync-tracker-state',
      inputRecordRef,
      job.data.stageAttempt
    ) as SyncTrackerStateJobData,
  };
}

export async function runMakePrFlow(job: Job<MakePrJobData>): Promise<void> {
  const logger = createJobLogger(job);

  try {
    const result = await runMakePrWork(job, logger);

    switch (result.status) {
      case 'no-changes':
        if (result.syncTrackerStateJobData) {
          await scheduleNextJob(jobQueue, 'sync-tracker-state', result.syncTrackerStateJobData);
        } else {
          logger.info(`Cleaning up temp working directory: ${result.workspacePath}`);
          await cleanupWorkingDir(result.workspacePath);
        }
        return;
      case 'pull-request-already-exists':
      case 'pull-request-creation-failed':
        logger.info(`Make PR stopped with terminal status: ${result.status}`);
        return;
      case 'pull-request-created':
        await scheduleNextJob(jobQueue, 'sync-tracker-state', result.syncTrackerStateJobData);
        return;
    }
  } catch (err) {
    logger.error(`Make PR operation failed: ${err}`);
    try {
      await updateRunStatus(resolveOrchestrationStorageRoot(job.data.inputRecordRef), job.data.runId, {
        heading: 'Blast Furnace stopped before creating a pull request',
        focus: 'Final state: Pull request creation failed',
        items: [
          statusItem('draft-pr-and-in-review', 1, 'failed', 'Make PR', 'PR was not created'),
        ],
      }, logger);
    } catch {
      // Preserve original Make PR failure.
    }
    throw err;
  }
}

export const processMakePr = runMakePrFlow;
export const makePrHandler = processMakePr;
