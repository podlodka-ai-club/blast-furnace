# Change: Add Pipeline Step Jobs

## Why
The current automation flow skips directly from assessment to development and keeps later pipeline concerns coupled to the Codex provider. Separate jobs and modules for each pipeline step will make future parallel development easier and create clear handoff boundaries.

## What Changes
- Add a `plan` job and isolated Plan module that receives assessed issue data and forwards it unchanged to `codex-provider`.
- Add a `review` job and isolated Review module that receives development output and forwards it unchanged to `make-pr`.
- Add a `make-pr` job and isolated Make PR module that owns deterministic commit, push, pull request creation, and label transition.
- Update existing pipeline handoffs so `issue-processor` schedules `plan`, and `codex-provider` schedules `review` after successful development processing.
- Move commit, push, pull request creation, and label transition responsibilities out of `codex-provider`.
- Update worker routing and shared job payload types for the new job kinds.

## Impact
- Affected specs: `github-issue-automation`, `issue-processing`, `job-queue`, `plan-job`, `review-job`, `make-pr-job`
- Affected code: `src/types/index.ts`, `src/index.ts`, `src/jobs/issue-processor.ts`, `src/jobs/codex-provider.ts`, new job modules under `src/jobs/`, and related tests
