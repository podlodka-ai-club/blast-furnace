import { githubClient } from './client.js';
import { config } from '../config/index.js';

export const READY_LABEL = 'ready';
export const IN_REVIEW_LABEL = 'in review';

function dedupeLabels(labels: string[]): string[] {
  return [...new Set(labels)];
}

export async function moveIssueToInReview(issueNumber: number): Promise<string[]> {
  const response = await githubClient.issues.listLabelsOnIssue({
    owner: config.github.owner,
    repo: config.github.repo,
    issue_number: issueNumber,
  });

  const currentLabels = response.data
    .map((label) => label.name)
    .filter((label): label is string => typeof label === 'string');

  const nextLabels = dedupeLabels([
    ...currentLabels.filter((label) => label !== READY_LABEL),
    IN_REVIEW_LABEL,
  ]);

  await githubClient.issues.setLabels({
    owner: config.github.owner,
    repo: config.github.repo,
    issue_number: issueNumber,
    labels: nextLabels,
  });

  return nextLabels;
}
