import { randomUUID } from 'node:crypto';
import { spawn } from 'child_process';
import type { Job } from 'bullmq';
import type {
  AssessJobData,
  GitHubIssue,
  PrepareRunJobData,
  PrepareRunOutput,
  RepositoryIdentity,
} from '../types/index.js';
import { getRef, pushBranch, deleteBranch } from '../github/branches.js';
import { assertConfiguredRepository } from '../github/repository.js';
import {
  cloneRepoInto,
  cleanupWorkingDir,
  createGitCommandEnv,
  createTempWorkingDir,
  getRepoRemoteUrl,
} from '../utils/working-dir.js';
import { stageOutputSchemas } from './handoff-contracts.js';
import { createJobLogger } from './logger.js';
import { jobQueue } from './queue.js';
import {
  appendHandoffRecordAndUpdateSummary,
  createRunFileSet,
  initializeRunSummary,
  resolveOrchestrationStorageRoot,
  scheduleNextJob,
} from './orchestration.js';
import { createForwardStagePayload } from './stage-payloads.js';

interface PrepareRunState {
  branchName: string | null;
  branchCreated: boolean;
  workspacePath: string | null;
  cleaned: boolean;
}

export interface PrepareRunWorkResult {
  assessJobData: AssessJobData;
}

export interface CreatePrepareRunPayloadInput {
  issue: GitHubIssue;
  repository: RepositoryIdentity;
  taskId?: string;
  runId?: string;
}

export function createPrepareRunPayload(input: CreatePrepareRunPayloadInput): PrepareRunJobData {
  const runId = input.runId ?? randomUUID();

  return {
    taskId: input.taskId ?? `prepare-run-${input.issue.id}-${runId}`,
    type: 'prepare-run',
    runId,
    stage: 'prepare-run',
    stageAttempt: 1,
    reworkAttempt: 0,
    issue: input.issue,
    repository: input.repository,
  };
}

function slugify(text: string): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  if (slug.length > 50) {
    const lastHyphen = slug.lastIndexOf('-', 50);
    slug = lastHyphen > 0 ? slug.slice(0, lastHyphen) : slug.slice(0, 50);
  }

  slug = slug.replace(/-+$/, '');
  return slug || 'issue';
}

function validateBranchName(branchName: string): void {
  if (!branchName || branchName.includes('..') || branchName.startsWith('-') || /\s/.test(branchName)) {
    throw new Error(`Invalid branch name: ${branchName}`);
  }
}

export function prepareIssueBranchName(issue: PrepareRunJobData['issue']): string {
  const branchName = `issue-${issue.number}-${slugify(issue.title)}`;
  validateBranchName(branchName);
  return branchName;
}

function execGitCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: createGitCommandEnv() });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = Number(process.env['GIT_COMMAND_TIMEOUT_MS'] ?? 120000);
    const commandTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(() => reject(new Error(`git command timed out after ${commandTimeoutMs}ms`)));
    }, commandTimeoutMs);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        settle(() => resolve(stdout.trim()));
      } else {
        settle(() => reject(new Error(`git command failed: ${stderr}`)));
      }
    });

    child.on('error', (err) => {
      settle(() => reject(err));
    });
  });
}

async function fetchBranchWithRetry(
  branchName: string,
  cwd: string,
  logger: ReturnType<typeof createJobLogger>,
  maxRetries = 3
): Promise<void> {
  const remoteUrl = getRepoRemoteUrl();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await execGitCommand(['fetch', remoteUrl, `heads/${branchName}`], cwd);
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt - 1) * 1000;
      logger.warn(`Fetch attempt ${attempt} failed for ${branchName}: ${err}, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function checkoutPreparedBranch(
  branchName: string,
  workspacePath: string,
  logger: ReturnType<typeof createJobLogger>
): Promise<void> {
  await fetchBranchWithRetry(branchName, workspacePath, logger);

  const branchExists = await execGitCommand(['rev-parse', '--verify', '--quiet', branchName], workspacePath)
    .then(() => true)
    .catch(() => false);

  if (branchExists) {
    await execGitCommand(['checkout', branchName], workspacePath);
  } else {
    await execGitCommand(['checkout', '-b', branchName, '--track', `origin/${branchName}`], workspacePath);
  }

  await execGitCommand(['reset', '--hard', `origin/${branchName}`], workspacePath);
}

async function cleanupPrepareRunFailure(
  state: PrepareRunState,
  logger: ReturnType<typeof createJobLogger>
): Promise<void> {
  if (state.cleaned) return;
  state.cleaned = true;

  if (state.workspacePath) {
    try {
      logger.info(`Cleaning up prepared workspace: ${state.workspacePath}`);
      await cleanupWorkingDir(state.workspacePath);
    } catch (err) {
      logger.error(`Failed to clean up prepared workspace ${state.workspacePath}: ${err}`);
    }
  }

  if (state.branchCreated && state.branchName) {
    try {
      await deleteBranch(state.branchName);
      logger.info(`Cleaned up orphaned branch ${state.branchName}`);
    } catch (err) {
      logger.error(`Failed to clean up orphaned branch ${state.branchName}: ${err}`);
    }
  }
}

export async function runPrepareRunWork(
  job: Job<PrepareRunJobData>,
  logger = createJobLogger(job),
  state: PrepareRunState = {
    branchName: null,
    branchCreated: false,
    workspacePath: null,
    cleaned: false,
  }
): Promise<PrepareRunWorkResult> {
  const { issue, repository, runId, stageAttempt } = job.data;
  assertConfiguredRepository(repository);

  const branchName = prepareIssueBranchName(issue);
  state.branchName = branchName;

  logger.info(`Preparing run ${runId} for issue #${issue.number} on branch ${branchName}`);
  logger.info(`Issue body: ${issue.body ?? '(no body)'}`);

  await job.updateProgress?.({ step: 'creating-workspace', runId });
  const workspacePath = await createTempWorkingDir('prepare-run');
  state.workspacePath = workspacePath;
  const orchestrationRoot = resolveOrchestrationStorageRoot();
  const runStartedAt = new Date().toISOString();
  const runFileSet = createRunFileSet(orchestrationRoot, runId, new Date(runStartedAt));

  let sha: string;
  try {
    await job.updateProgress?.({ step: 'fetching-main-ref', runId });
    sha = await getRef('main');
  } catch (err) {
    logger.error(`Failed to get ref for main: ${err}`);
    throw err;
  }

  let branchExists = false;
  try {
    await getRef(branchName);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    logger.info(`Branch ${branchName} already exists, reusing it`);
  } else {
    logger.info(`Creating branch: ${branchName}`);
    await job.updateProgress?.({ step: 'creating-branch', branch: branchName, runId });
    await pushBranch(branchName, sha);
    state.branchCreated = true;
  }

  await job.updateProgress?.({ step: 'verifying-branch', branch: branchName, runId });
  const verifySha = await getRef(branchName);
  logger.info(`Branch ${branchName} verified (SHA: ${verifySha})`);

  const remoteUrl = getRepoRemoteUrl();
  logger.info(`Cloning repository into prepared workspace: ${workspacePath}`);
  await cloneRepoInto(workspacePath, remoteUrl);

  logger.info(`Checking out prepared branch: ${branchName}`);
  await checkoutPreparedBranch(branchName, workspacePath, logger);

  await initializeRunSummary(orchestrationRoot, runFileSet, {
    runId,
    status: 'running',
    currentStage: 'prepare-run',
    runStartedAt,
    stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    latestHandoffRecord: null,
    stages: {
      'prepare-run': {
        attempts: stageAttempt,
        status: 'running',
      },
    },
  });

  const output = stageOutputSchemas['prepare-run'].parse({
    status: 'success',
    branchName,
    workspacePath,
    runId,
    issue,
    repository,
    stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
  }) as PrepareRunOutput;
  const { inputRecordRef } = await appendHandoffRecordAndUpdateSummary(orchestrationRoot, {
    runId,
    fromStage: 'prepare-run',
    toStage: 'assess',
    stageAttempt,
    reworkAttempt: job.data.reworkAttempt,
    dependsOn: null,
    status: 'success',
    output,
  });

  const assessJobData = createForwardStagePayload(job.data, 'assess', inputRecordRef) as AssessJobData;

  return {
    assessJobData,
  };
}

export async function runPrepareRunFlow(job: Job<PrepareRunJobData>): Promise<void> {
  const logger = createJobLogger(job);
  const state: PrepareRunState = {
    branchName: null,
    branchCreated: false,
    workspacePath: null,
    cleaned: false,
  };
  let handoffCompleted = false;

  try {
    const result = await runPrepareRunWork(job, logger, state);
    await job.updateProgress?.({ step: 'enqueueing-assess', issue: job.data.issue.number });
    await scheduleNextJob(jobQueue, 'assess', result.assessJobData);
    handoffCompleted = true;
    logger.info(`Assess job enqueued for run: ${result.assessJobData.runId}`);
  } catch (err) {
    if (!handoffCompleted) {
      await cleanupPrepareRunFailure(state, logger);
    }
    throw err;
  }
}

export const prepareRunHandler = runPrepareRunFlow;
