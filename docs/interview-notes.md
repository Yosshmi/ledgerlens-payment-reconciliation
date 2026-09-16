# Implementation notes for later study

These notes preserve engineering context during development. The final learning
package and resume claims are deferred until the application is publicly deployed
and the complete release gate has passed.

## What is LedgerLens?

A payment-operations workspace that compares operational payments, simulated ledger
evidence, refunds and uploaded settlement records. Analysts investigate discrepancies
through transaction timelines and reconciliation incidents.

## Main flows

**Login:** React form → Express validation and bcrypt → persisted session + signed
HttpOnly cookie → authenticated user and tenant context → dashboard API calls.

**Refund:** authenticated finance/admin request → runtime validation → tenant/key
fingerprint → atomic conditional reservation → refund/event/audit/job transaction →
outbox dispatcher → BullMQ worker → signed HTTP webhook → refund and ledger update →
new reconciliation job → Django projection and incident rules.

**Settlement:** multipart upload → bounded temporary file → GridFS → MongoDB job →
BullMQ → streamed full-file validation → 250-row upserts → finalized settlement →
batched Django snapshots → incident records and SQL aggregates.

**Investigation:** tenant-filtered payment detail → events ordered by timestamp →
refunds/settlement rows/audit → separately fetched Django incidents → role-authorized
assignment, notes and disposition with immutable activity entries.

## Decisions worth explaining

1. Authentication identifies a user. Authorization decides which actions that user
   can perform. Tenant filtering is required in addition to role checks.
2. An IDOR is access to another user's or tenant's object by changing an identifier.
   Knowing a transaction ID is not authorization; the query must include organization.
3. Idempotency handles retries of the same intent; balance reservations handle
   different concurrent intents. Both are needed for safe partial refunds.
4. The outbox closes the database/queue gap: a crash after committing money cannot
   lose the job because it was committed in the same MongoDB transaction.
5. At-least-once delivery is expected. Unique event IDs and stable settlement row keys
   make worker replays harmless. No exactly-once processing claim is made.
6. Money is stored as integer paise. Dividing by 100 happens only for display; comparison
   and balance updates remain integers.
7. MongoDB owns operations and event documents. PostgreSQL owns structured comparisons,
   incidents and reporting. Django has a real domain rather than duplicated CRUD.
8. No Kafka is needed for this workload. Redis/BullMQ supplies retries and queue state
   with substantially less operating complexity.
9. SQL row locks serialize projection updates. A version check refuses stale payment
   snapshots, but this is still eventual consistency across databases.
10. Indexes start with the tenant filter, then common equality filters, then sort fields.
    A contains-regex query is not magically fast because some other field is indexed.
11. Large CSV parsing belongs in the worker. The HTTP request only accepts and durably
    stores the file; 50,000 rows are processed with bounded batches.
12. A worker crash may replay completed steps. Upload row upserts, webhook deduplication
    and reconciliation uniqueness are designed for that possibility.
13. Public demo users cannot perform mutations, even if they construct requests manually.
14. Tests cover financial races and security boundaries rather than only happy-path CRUD.
15. Docker packages processes; Compose wires the services and persistent volumes. CI
    tests the real PostgreSQL and Redis-backed stack independently of a developer's OS.

## Scaling discussion

Before claiming support for 10 million payments: benchmark actual workloads, migrate
explorer pagination to a cursor, provide an appropriate search index, add snapshot
ordering for concurrent workers, partition reconciliation by tenant/merchant, introduce
incremental projection batches, bound history retention, and measure query plans.
Do not claim these changes or performance numbers already exist.

## Hardest observed bugs

See `docs/review.md` for the issues actually found by integration and browser tests.
They are concrete examples for explaining how verification changed the implementation.
