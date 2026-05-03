import type {
  GitHubIssue,
  RepositoryIdentity,
  RunStatusMetadata,
  StatusChecklistItem,
  StatusItemStage,
  StatusItemState,
} from '../types/index.js';
import { trackerClient, type TrackerClient } from '../tracker/github.js';
import {
  createInitialStatusMetadata,
  createReworkStatusItems,
  makeStatusItem,
  upsertStatusItems,
} from '../tracker/status.js';
import { readRunSummary, writeRunSummary } from './orchestration.js';

export interface StatusLogger {
  warn(message: string): void;
}

export interface RunStatusUpdate {
  heading?: string;
  focus?: string;
  note?: string;
  items?: StatusChecklistItem[];
}

function issueAndRepository(summaryIssue: GitHubIssue | undefined, summaryRepository: RepositoryIdentity | undefined): {
  issue: GitHubIssue;
  repository: RepositoryIdentity;
} {
  if (!summaryIssue || !summaryRepository) {
    throw new Error('Run summary must contain issue and repository identity before status update');
  }
  return { issue: summaryIssue, repository: summaryRepository };
}

export async function updateRunStatus(
  root: string,
  runId: string,
  update: RunStatusUpdate,
  logger?: StatusLogger,
  client: TrackerClient = trackerClient
): Promise<RunStatusMetadata | null> {
  const summary = await readRunSummary(root, runId);
  if (!summary) {
    throw new Error(`Run summary not found for ${runId}`);
  }
  const { issue, repository } = issueAndRepository(
    summary.initialContext?.issue ?? summary.stableContext?.issue,
    summary.initialContext?.repository ?? summary.stableContext?.repository
  );
  const now = new Date().toISOString();
  const existing = summary.trackerStatus ?? createInitialStatusMetadata(now);
  const next: RunStatusMetadata = {
    ...existing,
    heading: update.heading ?? existing.heading,
    focus: update.focus ?? existing.focus,
    note: update.note ?? existing.note,
    checklist: update.items ? upsertStatusItems(existing.checklist, update.items) : existing.checklist,
    lastChangedAt: now,
  };

  try {
    const persisted = await client.createOrUpdateStatusComment({
      runId,
      issueNumber: issue.number,
      repository,
      status: next,
    });
    await writeRunSummary(root, {
      ...summary,
      trackerStatus: persisted,
    });
    return persisted;
  } catch (err) {
    logger?.warn(`Failed to update orchestrator status for run ${runId}: ${err}`);
    await writeRunSummary(root, {
      ...summary,
      trackerStatus: next,
    });
    return null;
  }
}

export function statusItem(
  stage: StatusItemStage,
  attempt: number,
  state: StatusItemState,
  label: string,
  detail?: string,
  reworkAttempt = 0
): StatusChecklistItem {
  return makeStatusItem(stage, attempt, state, label, detail, reworkAttempt);
}

export function reworkStatusItems(reworkAttempt: number): StatusChecklistItem[] {
  return createReworkStatusItems(reworkAttempt);
}

export function developStatusItem(attempt: number, state: StatusItemState, detail?: string, reworkAttempt = 0): StatusChecklistItem {
  return statusItem('develop', attempt, state, attempt === 1 ? 'Develop changes' : `Develop rework ${attempt - 1}`, detail, reworkAttempt);
}

export function qualityStatusItem(attempt: number, state: StatusItemState, detail?: string, reworkAttempt = 0): StatusChecklistItem {
  return statusItem('quality-gate', attempt, state, attempt === 1 ? 'Quality Gate' : `Quality Gate rework ${attempt - 1}`, detail, reworkAttempt);
}

export function reviewStatusItem(attempt: number, state: StatusItemState, detail?: string, reworkAttempt = 0): StatusChecklistItem {
  return statusItem('review', attempt, state, attempt === 1 ? 'Code Review' : `Code Review attempt ${attempt}`, detail, reworkAttempt);
}
