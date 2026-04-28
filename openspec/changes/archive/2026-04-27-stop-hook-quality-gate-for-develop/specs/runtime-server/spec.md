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
- **AND** default `CODEX_MODEL` to `gpt-5.4`
- **AND** default `CODEX_TIMEOUT_MS` to `300000`
- **AND** default `QUALITY_GATE_TEST_TIMEOUT_MS` to `180000`
- **AND** leave `QUALITY_GATE_TEST_COMMAND` unset when absent

#### Scenario: Quality Gate command is configured
- **WHEN** `QUALITY_GATE_TEST_COMMAND` is present in the environment
- **THEN** runtime configuration SHALL expose that command to Develop without inferring or modifying it from target repository files
- **AND** Develop SHALL use that command as deterministic deployment configuration for Quality Gate

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
- **WHEN** `QUALITY_GATE_TEST_TIMEOUT_MS` is less than `1` or invalid
- **THEN** the system SHALL use `180000`

#### Scenario: Startup requires GitHub target configuration
- **WHEN** the application starts without `GITHUB_TOKEN`, `GITHUB_OWNER`, or `GITHUB_REPO`
- **THEN** startup SHALL fail with an error naming the missing variable

#### Scenario: Quality Gate command is absent at startup
- **WHEN** the application starts without `QUALITY_GATE_TEST_COMMAND`
- **THEN** startup SHALL NOT fail solely because the Quality Gate command is absent
- **AND** Develop SHALL later record a `misconfigured` quality result if a run reaches Quality Gate without the command configured
