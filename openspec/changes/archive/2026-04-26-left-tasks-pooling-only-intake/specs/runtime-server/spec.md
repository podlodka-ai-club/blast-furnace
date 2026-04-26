## MODIFIED Requirements

### Requirement: Environment Configuration
The system SHALL load runtime configuration from environment variables with documented defaults and validation.

#### Scenario: Defaults are used for optional configuration
- **WHEN** optional environment variables are absent
- **THEN** the system SHALL default `NODE_ENV` to `development`
- **AND** default `PORT` to `3000`
- **AND** default `REDIS_HOST` to `localhost`
- **AND** default `REDIS_PORT` to `6379`
- **AND** default `GITHUB_POLL_INTERVAL_MS` to `60000`
- **AND** default `CODEX_CLI_PATH` to `npx @openai/codex`
- **AND** default `CODEX_TIMEOUT_MS` to `300000`

#### Scenario: Legacy webhook configuration is present
- **WHEN** `GITHUB_ISSUE_STRATEGY` or `GITHUB_WEBHOOK_SECRET` is present in the environment
- **THEN** runtime configuration SHALL NOT expose an issue strategy setting
- **AND** runtime configuration SHALL NOT expose a webhook secret setting
- **AND** startup SHALL continue to use polling intake without a compatibility warning

#### Scenario: Invalid numeric values are rejected
- **WHEN** `PORT` or `REDIS_PORT` is not a valid TCP port
- **THEN** the system SHALL use the configured default value
- **WHEN** `GITHUB_POLL_INTERVAL_MS` is less than `1000` or invalid
- **THEN** the system SHALL use `60000`
- **WHEN** `CODEX_TIMEOUT_MS` is less than `1`, greater than `600000`, or invalid
- **THEN** the system SHALL use `300000`

#### Scenario: Startup requires GitHub target configuration
- **WHEN** the application starts without `GITHUB_TOKEN`, `GITHUB_OWNER`, or `GITHUB_REPO`
- **THEN** startup SHALL fail with an error naming the missing variable

### Requirement: HTTP Server
The system SHALL expose a Fastify HTTP server with CORS and JSON parsing behavior suitable for API routes.

#### Scenario: Server is built
- **WHEN** the server is constructed
- **THEN** it SHALL register CORS using `CORS_ORIGIN`
- **AND** treat `CORS_ORIGIN=*` as allowing all origins
- **AND** split comma-separated origin strings into allowed origins
- **AND** SHALL NOT preserve raw JSON request bytes for webhook signature validation

#### Scenario: Webhook route is requested
- **WHEN** a client requests `POST /webhooks/github`
- **THEN** the server SHALL return its normal missing-route response
- **AND** SHALL NOT enqueue an issue processor job

#### Scenario: Invalid JSON is received
- **WHEN** a request with content type `application/json` contains invalid JSON
- **THEN** the server SHALL reject it with a bad request error
