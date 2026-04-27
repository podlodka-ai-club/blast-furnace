## 1. Types and Routing
- [x] 1.1 Add shared job payload typing for `check-pr`, including the data handed off from `make-pr`.
- [x] 1.2 Add worker routing and routing tests for the new `check-pr` job kind.

## 2. Pipeline Handoffs
- [x] 2.1 Update Make PR tests to cover enqueueing `check-pr` instead of cleaning up directly.
- [x] 2.2 Update `make-pr` so it remains responsible for deterministic commit, push, pull request creation, and label transition, then hands terminal processing to `check-pr`.
- [x] 2.3 Ensure the Make PR to Check PR handoff supports both outcomes: pull request created and no pull request created.

## 3. Check PR Module
- [x] 3.1 Add focused tests for the Check PR module, including cleanup on success and cleanup after upstream no-change outcomes.
- [x] 3.2 Add an isolated Check PR job module that receives Make PR output and owns temporary repository cleanup.

## 4. Validation
- [x] 4.1 Run `npm test`.
- [x] 4.2 Run `npm run lint`.
- [x] 4.3 Run `npm run build`.
