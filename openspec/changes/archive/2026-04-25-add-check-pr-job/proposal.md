# Change: Add Check PR Job

## Why
The current pipeline ends in `make-pr`, which mixes pull request creation with temporary workspace cleanup. Adding a dedicated post-PR stage creates a clearer terminal handoff and gives the pipeline an explicit place for post-PR handling without keeping cleanup coupled to PR creation.

## What Changes
- Add a `check-pr` job and isolated Check PR module as the terminal pipeline stage after `make-pr`.
- Update `make-pr` to enqueue `check-pr` after it finishes its deterministic finalization outcome instead of cleaning up the temporary repository path itself.
- Move temporary working directory cleanup ownership from `make-pr` to `check-pr`.
- Update shared job payload types and worker routing for the new `check-pr` job kind.
- Preserve existing Make PR responsibilities for change detection, commit, push, pull request creation, and label transition.

## Impact
- Affected specs: `github-issue-automation`, `issue-processing`, `job-queue`, `make-pr-job`, `check-pr-job`
- Affected code: `src/types/index.ts`, `src/jobs/make-pr.ts`, new `src/jobs/check-pr.ts`, worker routing, and related tests
