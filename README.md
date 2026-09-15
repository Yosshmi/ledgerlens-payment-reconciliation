# LedgerLens

Payment Reconciliation & Transaction Investigation Platform

Investigate transactions. Detect inconsistencies. Reconcile payments.

## Status

Under active development. No public deployment is verified yet.

## Architecture

React and TypeScript provide the operations workspace. Express owns authentication,
tenant-scoped operational records, refunds, signed webhooks and settlement ingestion
in MongoDB. Redis/BullMQ workers process asynchronous work. Django REST Framework
owns reconciliation rules, incidents and reporting in PostgreSQL.

All payments use a simulated gateway; monetary amounts are integer minor units.
