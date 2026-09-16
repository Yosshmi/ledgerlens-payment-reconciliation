# Database design

## MongoDB: operational source of truth

Organization, User, Session, Merchant, Payment, Event, Refund, Webhook, Job,
Settlement, SettlementRow, and Audit are separate collections. GridFS stores upload
bytes so any worker can process them. Business identifiers are random readable
prefixes; `_id` is not used for authorization or navigation.

Every operational collection carries an organization reference, except global
session and webhook identifiers. Every browser lookup includes authenticated
organization context. Session lookup is by the signed JWT's random session ID.

Payment stores `amountMinor`, `refundedMinor`, `reservedRefundMinor`, and integer
ledger summaries. A conditional atomic update reserves a refund only when the
remaining amount covers it. A replica-set transaction also creates the refund,
event, audit entry and outbox job. Successful webhook handling moves reserved funds
to refunded funds; failure releases the reservation. There is no floating-point
currency conversion in these operations.

### Indexes and reasons

| Collection | Index | Query / invariant |
|---|---|---|
| Payment | unique transactionId | Business lookup |
| Payment | organization + createdAt descending | Default explorer page |
| Payment | organization + status + createdAt descending | Status-filtered explorer |
| Payment | organization + merchantId + createdAt descending | Merchant investigation |
| Payment | organization + gatewayReference | Gateway lookup |
| Refund | unique organization + idempotencyKey | Concurrent duplicate protection |
| Refund | organization + transactionId + createdAt | Investigation refund history |
| Event | organization + transactionId + timestamp | Timeline |
| SettlementRow | unique organization + settlementId + rowNumber | Retry-safe ingestion |
| SettlementRow | organization + transactionId | Reconciliation join |
| Job | state + createdAt | Durable outbox scan |
| Job | organization + createdAt | Upload history |
| Audit | organization + entityId + createdAt | Entity audit history |
| Session | expiresAt TTL | Expired session cleanup; authorization checks expiry immediately |

Unique business identifiers and tenant-prefixed organization indexes also exist.
Contains search uses escaped case-insensitive regex and a five-second query budget.
It is not claimed to be a full-text search engine. At much larger scale, use a
dedicated search index and keyset pagination; do not add indexes to every filter.

## PostgreSQL: reconciliation and reporting

`PaymentProjection` has unique `(organization, transaction_id)`, aggregate-friendly
columns, timestamps, and the input snapshot as JSON. The worker batches 250 records
and bulk-fetches refunds and settlement rows to avoid one HTTP request per payment.

`Incident` has unique `(organization, transaction_id, type)`. This makes repeated
reconciliation idempotent. `IncidentActivity` is a foreign-key child containing
server-attributed notes and transition history. Tenant/status/time and tenant/payment
indexes serve the incident inbox and investigation page.

Projection rows are locked while applying rules. Older operational versions cannot
overwrite newer versions. A cleared discrepancy marks `condition_present=false`;
human dispositions are preserved. A resolved condition that clears and recurs reopens.

## Boundaries and trade-offs

- MongoDB transactions require a replica set; a standalone `mongod` is unsupported.
- Ledger fields are simulated balance evidence, not a general-purpose double-entry ledger.
- Analytical consistency is eventual. Screens show the last reconciliation time.
- Use one worker for this deployment. Cross-database snapshots are not globally atomic;
  periodic reconciliation repairs interleaving changes. Horizontal scale requires a
  stronger projection sequence or per-tenant ordering before increasing worker count.
- Current archive/retention is manual. Upload bytes and audit records are retained.
- Snapshot payloads cap a payment's settlement/refund arrays at 1,000 each. This is
  an explicit operational limit; heavily duplicated historical data needs summarized
  projections before scaling beyond it.
- The production stack uses PostgreSQL. A clearly labeled Windows preview fallback
  uses SQLite when Docker cannot start; CI exercises PostgreSQL itself.
