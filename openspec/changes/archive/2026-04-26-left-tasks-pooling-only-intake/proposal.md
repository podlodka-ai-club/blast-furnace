## Why

Blast Furnace currently exposes two GitHub issue intake paths: polling and webhooks. Keeping both paths makes startup behavior, configuration, tests, and architecture ambiguous while the target orchestrator only needs one intake model for this iteration.

## What Changes

- **BREAKING**: Remove webhook intake as a supported runtime option, including `GITHUB_ISSUE_STRATEGY=webhook` and `POST /webhooks/github` from the active application contract.
- **BREAKING**: Remove `GITHUB_WEBHOOK_SECRET` from the working runtime configuration contract because webhook signature validation is no longer part of intake.
- Make polling through the repeatable `issue-watcher` job the only supported GitHub issue intake path.
- Remove startup branching between polling and webhook modes; application startup should consistently initialize polling intake.
- Update architecture language to call the stage `Intake` without splitting it into webhook and polling variants.
- Update tests, OpenSpec requirements, and documentation so they describe polling-only intake.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `issue-intake`: Replace configurable polling/webhook strategy requirements with a polling-only intake contract and remove the webhook endpoint requirement from supported behavior.
- `github-issue-automation`: Update product-level intake behavior so eligible issues are accepted only through polling discovery and asynchronous queueing.
- `runtime-server`: Remove runtime configuration requirements for issue strategy selection and webhook secret handling, and simplify startup/server behavior around the single intake path.

## Impact

- Affected runtime code: `src/index.ts`, `src/config/index.ts`, `src/types/index.ts`, `src/server/index.ts`, `src/server/routes/github-webhooks.ts`, and the polling watcher startup path in `src/jobs/issue-watcher.ts`.
- Affected tests: config tests, server/webhook route tests, application startup tests, issue intake tests, and any type tests that encode webhook strategy configuration.
- Affected documentation/specs: README and orchestration docs, plus OpenSpec specs for `issue-intake`, `github-issue-automation`, and `runtime-server`.
- External contract change: deployments can no longer select webhook intake through environment configuration; GitHub issue intake is polling-only.
