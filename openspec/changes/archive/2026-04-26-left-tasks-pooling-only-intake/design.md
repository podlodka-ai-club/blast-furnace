## Context

The current runtime models GitHub issue intake as a configurable strategy. `src/config/index.ts` parses `GITHUB_ISSUE_STRATEGY` into `polling | webhook`, `GitHubConfig` carries both `issueStrategy` and `webhookSecret`, `src/index.ts` starts the repeatable watcher only when the strategy is polling, and `src/server/index.ts` registers `POST /webhooks/github` only when the strategy is webhook.

Webhook support also adds route-specific machinery to the server: a raw JSON body parser for signature validation, `GITHUB_WEBHOOK_SECRET`, webhook payload mapping, and route tests. The target state keeps a single intake path: polling through the repeatable `issue-watcher` job, with architecture and documentation naming that stage simply `Intake`.

## Goals / Non-Goals

**Goals:**

- Make polling the only supported GitHub issue intake path.
- Remove runtime strategy selection between polling and webhook modes.
- Remove webhook-specific configuration from the active runtime contract.
- Ensure application startup consistently initializes the repeatable `issue-watcher` job.
- Keep existing polling behavior intact, including registered repositories, configured repository fallback, `ready` label filtering, and last-poll state handling.
- Update tests, OpenSpec, and documentation to describe one intake path.

**Non-Goals:**

- Changing GitHub issue eligibility rules beyond the existing open `ready` issue polling behavior.
- Changing repository management APIs or the polling registry storage model.
- Changing downstream pipeline stages after `issue-processor`.
- Adding a replacement push-based intake mechanism.
- Preserving webhook endpoint compatibility for deployments that currently depend on `POST /webhooks/github`.

## Decisions

1. Treat polling as an invariant instead of a configured strategy.

   Remove `issueStrategy` from `GitHubConfig`, remove `parseIssueStrategy`, and stop reading `GITHUB_ISSUE_STRATEGY`. `main()` should start `startIssueWatcher()` unconditionally after server startup succeeds, while preserving the existing required GitHub target configuration checks. The effective strategy is hardcoded by design: Intake is polling-only, with no compatibility warning for a leftover `GITHUB_ISSUE_STRATEGY` environment variable.

   Alternative considered: keep `GITHUB_ISSUE_STRATEGY` but reject or ignore `webhook`. That would reduce immediate type churn, but it keeps a misleading configuration surface and preserves the ambiguity this change is meant to remove.

2. Remove webhook intake from the runtime surface.

   Stop importing and registering `githubWebhooksRoute` from `buildServer`. Since no active runtime path should expose the endpoint, remove the route module and route-specific tests unless a separate non-runtime fixture is needed. Requests to `/webhooks/github` should receive the normal missing-route response.

   Alternative considered: leave the route implementation in the tree but never register it. That keeps unused security-sensitive code and tests around a path the product no longer supports.

3. Remove webhook-specific server parsing.

   The custom JSON parser in `buildServer` exists to preserve exact raw request bytes for webhook HMAC validation. Once webhook intake is removed, the server should rely on Fastify's standard JSON parsing behavior unless another route has a concrete need for raw body access.

   Alternative considered: keep the parser because it also rejects invalid JSON. Fastify already handles invalid JSON for normal API routes, and retaining raw-body handling would make the server look like it still supports signed webhook workflows.

4. Keep polling watcher behavior stable.

   `startIssueWatcher()` and `issueWatcherHandler()` remain the implementation of Intake. The change should not alter repeat interval semantics, repeatable job id, repository iteration, fallback repository behavior, issue mapping, queue payloads, or Redis last-poll state except where tests need wording updates from "polling strategy" to "Intake".

   Alternative considered: rename job types from `issue-watcher` to `intake` as part of this change. That would align names more tightly with target architecture, but it would broaden the change into queue payload compatibility and worker routing. This change should keep the technical job name stable while updating architectural language.

5. Update contracts and tests around removed config fields.

   Config tests should assert that `GITHUB_ISSUE_STRATEGY` and `GITHUB_WEBHOOK_SECRET` are no longer loaded into `config.github`. Type tests and mocks should remove those fields. Startup tests should verify the watcher is started without a strategy condition. Server tests should verify the webhook route is not registered as part of the normal server.

   Alternative considered: leave deprecated fields in the TypeScript config type. That would keep downstream call sites compiling with old assumptions and weaken the OpenSpec contract.

## Risks / Trade-offs

- Existing deployments that use GitHub webhooks will stop delivering work through `POST /webhooks/github` -> Document the breaking change and require polling configuration for repositories.
- Removing raw-body JSON parsing could change exact bad-request error details for malformed JSON -> Keep tests focused on status/behavior rather than internal error messages unless the API contract requires exact text.
- Unconditional watcher startup can make tests or local startup touch Redis sooner than before -> Keep queue/Redis dependencies mocked in tests and preserve existing startup order.
- Deleting webhook files can remove useful mapping code if webhook intake returns later -> Recover from git history if needed rather than keeping unsupported runtime code active or semi-active.

## Migration Plan

1. Update OpenSpec delta specs to describe polling-only intake.
2. Update config and shared types to remove webhook strategy and secret fields.
3. Update server construction to remove webhook route registration and raw-body parser.
4. Update application startup to always start the issue watcher after server startup.
5. Remove or retire webhook route tests and rewrite remaining tests around polling-only behavior.
6. Update README and orchestrator target-state documentation to remove webhook setup and strategy language.

Rollback is a code revert of this change. There is no data migration because the polling watcher already owns Redis state and repository registry data.

## Open Questions

- None.
