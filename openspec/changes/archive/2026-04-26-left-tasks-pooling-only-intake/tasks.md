## 1. Regression Tests

- [x] 1.1 Add or update config tests proving `config.github` no longer exposes `issueStrategy` or `webhookSecret`, even when `GITHUB_ISSUE_STRATEGY` and `GITHUB_WEBHOOK_SECRET` are present.
- [x] 1.2 Add or update startup tests proving application startup schedules `startIssueWatcher()` without checking an issue strategy.
- [x] 1.3 Add or update server tests proving `POST /webhooks/github` is not registered and does not enqueue issue processing work.
- [x] 1.4 Update type tests and test fixtures so polling-only GitHub config is the expected shape.
- [x] 1.5 Run the focused tests and confirm the new or updated expectations fail before implementation changes.

## 2. Runtime Configuration and Startup

- [x] 2.1 Remove `issueStrategy` and `webhookSecret` from `GitHubConfig` and all config consumers.
- [x] 2.2 Remove `parseIssueStrategy` and stop reading `GITHUB_ISSUE_STRATEGY` and `GITHUB_WEBHOOK_SECRET` from the config loader.
- [x] 2.3 Update `src/index.ts` so startup always calls `startIssueWatcher()` after the server starts.
- [x] 2.4 Update config mocks, fixtures, and imports to compile against the polling-only config contract.

## 3. Server Webhook Removal

- [x] 3.1 Remove webhook route registration and imports from `src/server/index.ts`.
- [x] 3.2 Remove webhook-specific raw JSON body preservation from server construction and rely on Fastify's normal JSON parsing.
- [x] 3.3 Delete or retire `src/server/routes/github-webhooks.ts` and route-specific tests once no runtime references remain.
- [x] 3.4 Remove obsolete webhook payload types from shared type definitions if they are no longer used.

## 4. Documentation and Specs

- [x] 4.1 Update README configuration, architecture, API endpoint, and directory documentation to remove webhook intake and strategy selection.
- [x] 4.2 Update orchestration documentation so the stage is described as `Intake` backed by polling through `issue-watcher`.
- [x] 4.3 Validate the OpenSpec change after implementation artifacts are complete.

## 5. Verification

- [x] 5.1 Run the focused test files affected by config, server startup, issue intake, and type contract changes.
- [x] 5.2 Run the full project test suite.
- [x] 5.3 Run lint and build to verify the removed webhook surface leaves no stale references.
