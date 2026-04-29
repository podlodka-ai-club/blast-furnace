# Handoff Ledger Migration

The simplified handoff ledger contract is not compatible with jobs already queued or running under the old cumulative-output contract.

Before deploying this change to an environment with active workflow jobs, use one of these rollout paths:

1. Drain the queues, let all old-contract workflow jobs finish, deploy the new code, then resume intake.
2. If queue draining is not acceptable, deploy temporary dual-reader support that can resolve both old records with `nextInput` and cumulative outputs and new records with stage-local outputs and dependency arrays.

Do not mix new downstream stages with old handoff records unless the temporary dual reader is present. The normal implementation expects `run.json` to contain stable run context, handoff records to omit `nextInput`, and every record dependency to be declared in `dependsOn` as a prior record id string.
