## 1. Make PR No-Change Path
- [x] 1.1 Update tests to cover `make-pr` cleaning up directly when no repository changes are produced.
- [x] 1.2 Update `make-pr` so the no-change path skips `check-pr`, performs cleanup itself, and remains terminal.

## 2. Check PR Scope
- [x] 2.1 Update tests and job payload expectations so `check-pr` is only used after successful pull request creation.
- [x] 2.2 Update `check-pr` implementation only as needed to reflect the narrower post-PR scope.

## 3. Validation
- [x] 3.1 Run `npm test`.
- [x] 3.2 Run `npm run lint`.
- [x] 3.3 Run `npm run build`.
