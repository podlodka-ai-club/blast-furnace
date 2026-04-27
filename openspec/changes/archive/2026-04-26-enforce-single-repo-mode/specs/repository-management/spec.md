## REMOVED Requirements

### Requirement: Repository Registry Storage
**Reason**: Runtime repository selection is single-repository and comes only from `GITHUB_OWNER` and `GITHUB_REPO`; Redis registry data must not control production intake.
**Migration**: Configure the supported repository through environment variables. Existing `github:repos` entries are ignored by runtime and may be deleted manually by operators.

### Requirement: Repository API
**Reason**: The JSON repository management API configures a multi-repository polling registry that is no longer part of the supported runtime contract.
**Migration**: Remove clients and scripts that call `GET /repos`, `POST /repos`, or `DELETE /repos/:owner/:repo`; use `GITHUB_OWNER` and `GITHUB_REPO` for the single target repository.

### Requirement: Repository Management UI
**Reason**: The management page exposes operator controls for a repository registry that production intake no longer honors.
**Migration**: Remove links or bookmarks to `/repos/manage`; single-repository configuration is handled by environment variables.
