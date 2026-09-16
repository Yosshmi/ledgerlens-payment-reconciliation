import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import {
  connect,
  Organization,
  User,
  Merchant,
  Payment,
  Event,
  Refund,
  Settlement,
  SettlementRow,
  Audit,
  Job,
  Webhook,
} from "./models.js";
import { fingerprint } from "./utils.js";
await connect();
const organization = "ORG_NOVAPAY";
await Organization.updateOne(
  { organization },
  { $setOnInsert: { name: "NovaPay Technologies" } },
  { upsert: true },
);
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 12)
  throw new Error(
    "Set DEMO_PASSWORD to a private password of at least 12 characters",
  );
const passwordHash = await bcrypt.hash(password, 12);
for (const user of [
  {
    userId: "USR_DEMO",
    email: "demo@ledgerlens.dev",
    name: "Demo Analyst",
    role: "VIEWER",
    demo: true,
  },
  {
    userId: "USR_ADMIN",
    email: "admin@ledgerlens.dev",
    name: "NovaPay Admin",
    role: "ADMIN",
    demo: false,
  },
])
  await User.updateOne(
    { userId: user.userId },
    { $setOnInsert: { ...user, organization, passwordHash } },
    { upsert: true },
  );
const merchants = ["UrbanCart", "FoodBox", "TravelNest", "StyleHub"];
for (const [index, name] of merchants.entries())
  await Merchant.updateOne(
    { merchantId: `MER_${name.toUpperCase()}` },
    {
      $setOnInsert: {
        organization,
        name,
        email: `finance@${name.toLowerCase()}.example`,
        status: "ACTIVE",
        settlementAccountReference: `ACCT_DEMO_${1001 + index}`,
      },
    },
    { upsert: true },
  );
const day = new Date();
day.setUTCHours(0, 0, 0, 0);
for (let n = 1; n <= 480; n++) {
  const transactionId = `TXN_DEMO_${String(n).padStart(5, "0")}`;
  if (await Payment.exists({ transactionId })) continue;
  const merchantId = `MER_${merchants[n % 4]!.toUpperCase()}`,
    amountMinor = 10000 + ((n * 7919) % 490000);
  const createdAt = new Date(
    day.getTime() - (29 - (n % 30)) * 86400_000 + ((n * 137) % 86400) * 1000,
  );
  const successful = n % 20 < 16,
    status = successful
      ? n % 17 === 0
        ? "PARTIALLY_REFUNDED"
        : "SUCCESS"
      : n % 20 < 19
        ? "FAILED"
        : "PENDING";
  const refundedMinor =
    status === "PARTIALLY_REFUNDED" ? Math.floor(amountMinor / 3) : 0;
  const missingCredit = successful && n % 31 === 0,
    missingDebit = successful && n % 47 === 0;
  await mongoose.connection.transaction(async (session) => {
    await Payment.create(
      [
        {
          transactionId,
          organization,
          merchantId,
          customerReference: `CUS_${String(10000 + n * 7)}`,
          amountMinor,
          currency: "INR",
          paymentMethod: ["UPI", "CARD", "NET_BANKING", "WALLET"][n % 4],
          status,
          gateway: "LENS_SIM",
          gatewayReference: `GW_DEMO_${String(n).padStart(7, "0")}`,
          refundedMinor,
          reservedRefundMinor: 0,
          ledgerDebitMinor: successful && !missingDebit ? amountMinor : 0,
          merchantCreditMinor: successful && !missingCredit ? amountMinor : 0,
          refundLedgerMinor: refundedMinor && n % 51 === 0 ? 0 : refundedMinor,
          settlementDueAt: new Date(createdAt.getTime() + 2 * 86400_000),
          createdAt,
          updatedAt: createdAt,
        },
      ],
      { session, ordered: true },
    );
    const types = [
      "PAYMENT_CREATED",
      "GATEWAY_REQUEST_SENT",
      ...(successful
        ? [
            "PAYMENT_AUTHORIZED",
            "PAYMENT_SUCCESS",
            missingDebit ? "LEDGER_DEBIT_FAILED" : "LEDGER_DEBIT_CREATED",
            missingCredit
              ? "MERCHANT_CREDIT_FAILED"
              : "MERCHANT_CREDIT_CREATED",
          ]
        : status === "FAILED"
          ? ["PAYMENT_FAILED"]
          : []),
    ];
    await Event.create(
      types.map((eventType, i) => ({
        eventId: `EVT_SEED_${n}_${i}`,
        organization,
        transactionId,
        eventType,
        source: "gateway-simulator",
        timestamp: new Date(createdAt.getTime() + i * 1000),
        metadata:
          eventType === "PAYMENT_FAILED"
            ? { reason: "Simulated issuer decline" }
            : {},
        correlationId: `COR_SEED_${n}`,
      })),
      { session, ordered: true },
    );
    if (refundedMinor) {
      const refundId = `RFD_DEMO_${n}`;
      await Refund.create(
        [
          {
            refundId,
            organization,
            transactionId,
            amountMinor: refundedMinor,
            reason: "Customer requested partial cancellation",
            status: "SUCCESS",
            createdBy: "USR_ADMIN",
            idempotencyKey: `seed-refund-${n}`,
            fingerprint: fingerprint({
              transactionId,
              amountMinor: refundedMinor,
            }),
            createdAt: new Date(createdAt.getTime() + 3600000),
          },
        ],
        { session, ordered: true },
      );
      await Event.create(
        [
          {
            eventId: `EVT_SEED_REFUND_${n}`,
            organization,
            transactionId,
            eventType: "REFUND_SUCCESS",
            source: "gateway-simulator",
            timestamp: new Date(createdAt.getTime() + 3600000),
            metadata: { refundId },
          },
        ],
        { session, ordered: true },
      );
    }
    if (successful && n % 43 === 0)
      await Refund.create(
        [
          {
            refundId: `RFD_FAILED_${n}`,
            organization,
            transactionId,
            amountMinor: 1000,
            reason: "Simulated gateway rejection",
            status: "FAILED",
            createdBy: "USR_ADMIN",
            idempotencyKey: `seed-failed-${n}`,
            fingerprint: fingerprint({ transactionId }),
            createdAt,
          },
        ],
        { session, ordered: true },
      );
    if (successful && n % 11 !== 0) {
      const settlementId = `STL_DEMO_${n}`,
        gross = amountMinor - (n % 29 === 0 ? 500 : 0),
        net = gross - Math.floor((gross * 2) / 100),
        settledAt = new Date(createdAt.getTime() + 86400_000),
        settlementStatus = n % 37 === 0 ? "FAILED" : "COMPLETED";
      await Settlement.create(
        [
          {
            settlementId,
            organization,
            merchantId,
            period: createdAt.toISOString().slice(0, 10),
            grossAmountMinor: gross,
            feesMinor: gross - net,
            netAmountMinor: net,
            transactionCount: n % 59 === 0 ? 2 : 1,
            status: settlementStatus,
            createdAt: settledAt,
            completedAt: settledAt,
          },
        ],
        { session, ordered: true },
      );
      await SettlementRow.create(
        Array.from({ length: n % 59 === 0 ? 2 : 1 }, (_, i) => ({
          organization,
          settlementId,
          rowNumber: i + 1,
          transactionId,
          merchantId,
          amountMinor: gross,
          settlementAmountMinor: net,
          status: settlementStatus,
          settledAt,
        })),
        { session, ordered: true },
      );
      await Event.create(
        [
          {
            eventId: `EVT_SEED_SETTLEMENT_${n}`,
            organization,
            transactionId,
            eventType:
              settlementStatus === "COMPLETED"
                ? "SETTLEMENT_COMPLETED"
                : "SETTLEMENT_FAILED",
            source: "settlement-worker",
            timestamp: settledAt,
            metadata: { settlementId },
          },
        ],
        { session, ordered: true },
      );
    }
    await Audit.create(
      [
        {
          auditId: `AUD_SEED_${n}`,
          organization,
          actor: "SYSTEM_SEED",
          action: "SIMULATED_PAYMENT_CREATED",
          entityType: "transaction",
          entityId: transactionId,
          createdAt,
          metadata: { simulated: true },
        },
      ],
      { session, ordered: true },
    );
  });
}
await Webhook.updateOne(
  { eventId: "EVT_DEMO_DUPLICATE" },
  {
    $setOnInsert: {
      organization,
      type: "payment.success",
      fingerprint: fingerprint({
        eventId: "EVT_DEMO_DUPLICATE",
        organization,
        type: "payment.success",
        reference: "TXN_DEMO_00001",
      }),
    },
  },
  { upsert: true },
);
await Job.updateOne(
  { jobId: "JOB_DEMO_RECONCILE" },
  {
    $set: {
      organization,
      kind: "RECONCILE",
      payload: {},
      state: "QUEUED",
      attempts: 0,
      error: null,
    },
  },
  { upsert: true },
);
console.log(
  "Seeded 480 simulated payments. Public demo uses /api/auth/demo; private admin password comes from DEMO_PASSWORD.",
);
await mongoose.disconnect();
