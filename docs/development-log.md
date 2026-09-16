# Development log

## Environment and repository baseline

- Inspected the workspace: only a fresh, unborn Git repository; no remote.
- The parent directory is not a Git repository. This checkout will hold LedgerLens.
- Node 24, npm 11, Python 3.14, Git and Docker CLI are installed.
- GitHub authentication is available. Docker Desktop must be started for integration tests.
- Preserve the requested stack and domain boundaries; this is a custom monorepo.
- Commit tested milestones naturally rather than manufacturing a commit count.

## Operational API

- Added runtime-validated configuration, Mongoose models and query-driven indexes.
- Implemented revocable cookie authentication, CSRF, RBAC and tenant-scoped resource access.
- Added transaction creation/exploration, authoritative events, refund reservations,
  request fingerprints and signed idempotent webhooks.
- Eight initial boundary tests passed; financial integration expanded this to 19 tests.
- A real multi-document transaction failure was found and fixed with ordered inserts.

## Reconciliation and worker

- Added PostgreSQL models/migration, eight pure reconciliation rules, tenant-scoped
  DRF APIs, incident activity and aggregate reporting.
- Nine Django tests pass locally and against PostgreSQL in GitHub Actions.
- Added durable MongoDB job outbox, Redis/BullMQ dispatcher, signed callback delivery,
  retry-safe CSV validation/upserts and batched internal HTTP reconciliation.
- Added 480 deterministic simulated payments, four merchants, refunds, settlement
  records, timeline events and intentional anomalies. Seed is repeatable and preserves
  existing records rather than deleting user data.

## UI and acceptance checks

- Added login/demo entry, responsive workspace, dashboard, transaction explorer,
  investigation, refund activity, settlements, incidents, analytics, merchants,
  member administration and audit history.
- Metrics come from Django/PostgreSQL projections, not frontend constants.
- Browser tests found and fixed absent event metadata and mobile overflow.
- Desktop investigation/search/incident/analytics and mobile navigation now pass locally.
- Saved desktop and mobile screenshots from the real running local services.

## Infrastructure

- New public GitHub repository is pushed with natural milestone commits.
- Added seven-service Compose stack, Dockerfiles, Nginx, HTTPS deployment overlay,
  CI for Node, PostgreSQL/Django and full-stack browser/worker acceptance.
- Local Docker Desktop cannot access a stale inference IPC socket. No factory reset,
  volume deletion or unrelated repository modification was performed.
- Local fallback uses real MongoDB and Django with SQLite for preview only. Linux
  CI is the authoritative check for the requested PostgreSQL/Redis/container topology.
- Public deployment remains gated on authenticated hosting access and DNS/billing.
  Final learning and resume packages have not been started prematurely.

## Final regression checkpoint

- Linux CI run 35080396854 passed Node, PostgreSQL/Django and the full Docker stack,
  including all three browser tests and the live signed worker workflow.
- Final review additionally guarded test database cleanup, handled missing GridFS
  stream errors and hardened failed/requeued job states; regression checks are rerun.
- Documentation and screenshots describe implemented behavior and explicitly label
  the public deployment gate. No live URL, real-money claim or performance result is invented.
