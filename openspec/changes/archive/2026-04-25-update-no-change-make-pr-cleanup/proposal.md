# Change: Update No-Change Make PR Cleanup

## Why
The current pipeline always hands terminal processing to `check-pr`, even when `make-pr` determines there were no repository changes and no pull request exists. That adds an unnecessary queue hop for a terminal no-op outcome and makes the no-change cleanup path less direct than it needs to be.

## What Changes
- Update `make-pr` so that when no repository changes are produced, it cleans up the temporary repository path itself and does not enqueue `check-pr`.
- Keep the existing `check-pr` handoff for the path where `make-pr` successfully creates a pull request.
- Update the `check-pr` capability so it only covers post-PR terminal handling, not the no-pull-request terminal path.

## Impact
- Affected specs: `make-pr-job`, `issue-processing`, `github-issue-automation`, `check-pr-job`
- Affected code: `src/jobs/make-pr.ts`, `src/jobs/check-pr.ts`, shared job payload tests, and related job tests
