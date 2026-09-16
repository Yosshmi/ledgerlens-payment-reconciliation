# API reference

All browser endpoints start with `/api`. Responses contain JSON, except successful
logout (204). Errors use `{success:false,error:{code,message}}`. Runtime validation
returns 422; missing authentication 401; permission/CSRF failures 403; unknown
tenant-scoped resources 404; financial/state conflicts 409; upload limits 413.

## Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | `{email,password}` → HttpOnly session cookie and CSRF token |
| POST | `/auth/demo` | Read-only demo session when enabled |
| GET | `/auth/me` | Current user, organization name, CSRF token |
| POST | `/auth/logout` | Revoke server session and clear cookie |

Mutation requests require the configured `Origin` and `X-CSRF-Token`. The signed
gateway endpoint is exempt from browser origin/CSRF checks. Public registration is
intentionally absent; administrators create organization members.

## Operational APIs

| Method | Path | Access / body |
|---|---|---|
| GET | `/merchants` | All roles; paginated |
| POST | `/merchants` | ADMIN; name, email, settlementAccountReference |
| GET | `/transactions` | All roles; database-filtered search |
| GET | `/transactions/:transactionId` | Payment, merchant, events, refunds, settlement rows, audit |
| POST | `/transactions` | ADMIN/ENGINEER; merchantId, customerReference, amountMinor, paymentMethod, outcome |
| POST | `/refunds` | ADMIN/FINANCE; transactionId, amountMinor, reason; `Idempotency-Key` required |
| GET | `/refunds` | Paginated refund records |
| POST | `/webhooks/gateway` | HMAC-authorized raw JSON gateway callback |
| POST | `/settlements/upload` | ADMIN/FINANCE; multipart `file`; 202 with job |
| GET | `/settlements` | Paginated settlements plus 20 recent upload jobs |
| GET | `/jobs/:jobId` | Tenant-scoped job state, progress, attempts, safe error |
| POST | `/jobs/:jobId/retry` | ADMIN/FINANCE/ENGINEER; failed jobs only |
| POST | `/reconciliation/run` | ADMIN/FINANCE/ENGINEER; queue full tenant refresh |
| GET | `/incidents` | Tenant-scoped search, status, severity, transactionId filters |
| GET/PATCH | `/incidents/:incidentId` | View / ADMIN, FINANCE, OPERATIONS updates |
| GET | `/analytics/:report` | overview, reconciliation, payment-health, refund-health, settlement-health |
| GET | `/analytics/merchant/:merchantId` | Merchant-specific report |
| GET | `/audit` | Paginated operational audit trail |
| GET/POST | `/users` | Member list / ADMIN creates a member |
| PATCH | `/users/:userId` | ADMIN changes another non-demo member's role |

Demo users are denied every mutation except logout, regardless of role.

List responses use `{items,total,page,limit,pages}`. Default page size is 25,
maximum 100, maximum page 10,000. Transaction filters: `search`, `status`,
`merchantId`, `paymentMethod`, ISO UTC `from`/`to`, `minAmount`/`maxAmount` in
minor units, and `sort` (`-createdAt`, `createdAt`, `amountMinor`, `-amountMinor`).

## Refund example

```http
POST /api/refunds
Origin: https://your-deployment.example
Idempotency-Key: customer-refund-001
X-CSRF-Token: <token from authenticated session>
Content-Type: application/json

{"transactionId":"TXN_ABC123","amountMinor":4999,"reason":"Customer cancellation"}
```

The same key and validated payload return the same refund. Reusing the key with a
different payload returns 409. Different keys cannot reserve more than the balance.

## Webhooks

Body: `{eventId,organization,type,reference}`. Supported types: payment.success,
payment.failed, refund.success, refund.failed, settlement.completed.
`reference` identifies the payment/refund/settlement as appropriate.

`X-Webhook-Timestamp` is Unix seconds (within five minutes). The hex
`X-Webhook-Signature` is HMAC-SHA256 over `timestamp + '.' + rawBody`.
Event IDs are globally unique; identical retries are acknowledged, conflicting
reuse is rejected. Terminal payment/refund outcomes cannot be reversed by late events.

## CSV contract

```csv
transaction_id,merchant_id,amount_minor,settlement_amount_minor,status,settled_at
TXN_ABC123,MER_URBANCART,10000,9800,COMPLETED,2026-09-15T00:00:00Z
```

One merchant per file, exact header order, integer amounts, ISO UTC dates, statuses
COMPLETED/FAILED/PENDING. Limit 10 MB, 50,000 rows, 4 KB per row. Referenced payments
must belong to the authenticated tenant and merchant. Gross amount is compared to
the payment; gross minus net is the settlement fee. Duplicate payment rows become
reconciliation incidents rather than being silently discarded.

## Internal Django APIs

`POST /api/reconcile/` accepts up to 250 payment snapshots. Only the worker's SYSTEM
role may submit them. `/api/incidents/`, `/api/incidents/:uuid/`, and analytics paths
are called through Express. Authentication requires the shared service bearer secret,
`X-Organization`, `X-Actor`, and `X-Role`. Keep Django private: these headers are trusted
only after service authentication. Service requests time out after 30 seconds.

`GET /health` is Express liveness; `/health/ready` checks MongoDB. Django `/health/`
checks its database. These endpoints intentionally expose no connection details.
