import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp } from "../app.js";
import {
  connect,
  Organization,
  User,
  Merchant,
  Payment,
  Refund,
  Audit,
  Event,
  Job,
  SettlementRow,
  Settlement,
} from "../models.js";
import { processSettlement } from "../workers/settlement.js";
import { createSession } from "../auth.js";
import { signWebhook } from "../finance.js";
const app = createApp(),
  origin = "http://localhost:5173";
let replica: MongoMemoryReplSet | undefined,
  admin: { cookie: string; csrf: string },
  viewer: { cookie: string; csrf: string },
  other: { cookie: string; csrf: string };
async function session(userId: string) {
  const s = await createSession(userId);
  return { cookie: `ll_session=${s.token}`, csrf: s.csrf };
}
function mutation(path: string, body: unknown, actor = admin) {
  return request(app)
    .post(path)
    .set("Origin", origin)
    .set("Cookie", actor.cookie)
    .set("X-CSRF-Token", actor.csrf)
    .send(body);
}
beforeAll(async () => {
  if (!process.env.TEST_MONGODB_URI) {
    replica = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.24" },
    });
    process.env.MONGODB_URI = replica.getUri("ledgerlens_test");
  }
  await connect();
  if (!mongoose.connection.name.endsWith("_test"))
    throw new Error(
      "Integration tests require a dedicated database ending in _test",
    );
  await Organization.create([
    { organization: "ORG_A", name: "A" },
    { organization: "ORG_B", name: "B" },
  ]);
  const passwordHash = await bcrypt.hash("test-password-12345", 4);
  await User.create([
    {
      userId: "USR_A",
      organization: "ORG_A",
      email: "a@example.test",
      name: "Admin A",
      role: "ADMIN",
      passwordHash,
    },
    {
      userId: "USR_V",
      organization: "ORG_A",
      email: "v@example.test",
      name: "Viewer A",
      role: "VIEWER",
      passwordHash,
    },
    {
      userId: "USR_B",
      organization: "ORG_B",
      email: "b@example.test",
      name: "Admin B",
      role: "ADMIN",
      passwordHash,
    },
  ]);
  await Merchant.create({
    merchantId: "MER_A",
    organization: "ORG_A",
    name: "Merchant A",
    email: "merchant@example.test",
    settlementAccountReference: "ACCT_TEST",
  });
  await Payment.create({
    transactionId: "TXN_A",
    organization: "ORG_A",
    merchantId: "MER_A",
    customerReference: "CUS_TEST",
    amountMinor: 10000,
    paymentMethod: "UPI",
    status: "SUCCESS",
    gatewayReference: "GW_A",
    ledgerDebitMinor: 10000,
    merchantCreditMinor: 10000,
    settlementDueAt: new Date(),
  });
  admin = await session("USR_A");
  viewer = await session("USR_V");
  other = await session("USR_B");
}, 180000);
afterAll(async () => {
  if (
    mongoose.connection.readyState === 1 &&
    mongoose.connection.name.endsWith("_test")
  )
    await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await replica?.stop();
});
describe("API integration: security and financial invariants", () => {
  it("requires authentication and validates login", async () => {
    expect((await request(app).get("/api/transactions")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .set("Origin", origin)
          .send({ email: "a@example.test", password: "wrong-password-1234" })
      ).status,
    ).toBe(401);
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "a@example.test", password: "test-password-12345" });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
  });
  it("isolates tenant reads and prevents IDOR", async () => {
    expect(
      (
        await request(app)
          .get("/api/transactions/TXN_A")
          .set("Cookie", other.cookie)
      ).status,
    ).toBe(404);
    const list = await request(app)
      .get("/api/transactions")
      .set("Cookie", other.cookie);
    expect(list.body.total).toBe(0);
    expect(
      (
        await mutation(
          "/api/refunds",
          { transactionId: "TXN_A", amountMinor: 100, reason: "Tenant attack" },
          other,
        ).set("Idempotency-Key", "tenant-attack-1")
      ).status,
    ).toBe(409);
  });
  it("enforces RBAC and CSRF on writes", async () => {
    expect(
      (
        await mutation(
          "/api/refunds",
          {
            transactionId: "TXN_A",
            amountMinor: 100,
            reason: "Not authorized",
          },
          viewer,
        ).set("Idempotency-Key", "viewer-attempt")
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/refunds")
          .set("Origin", origin)
          .set("Cookie", admin.cookie)
          .send({})
      ).status,
    ).toBe(403);
  });
  it("filters and paginates in the API", async () => {
    const response = await request(app)
      .get(
        "/api/transactions?status=SUCCESS&paymentMethod=UPI&minAmount=9000&limit=1&page=1",
      )
      .set("Cookie", admin.cookie);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(
      (
        await request(app)
          .get("/api/transactions?status=FAILED")
          .set("Cookie", admin.cookie)
      ).body.total,
    ).toBe(0);
  });
  it("creates users and merchants with server-owned tenant context", async () => {
    expect(
      (
        await mutation("/api/users", {
          name: "Test Finance",
          email: "finance@example.test",
          password: "test-finance-1234",
          role: "FINANCE",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await mutation("/api/merchants", {
          name: "New merchant",
          email: "new@example.test",
          settlementAccountReference: "ACCT_NEW",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await mutation("/api/merchants", {
          name: "Bad merchant",
          email: "bad@example.test",
          settlementAccountReference: "ACCT_BAD",
          organization: "ORG_B",
        })
      ).status,
    ).toBe(422);
  });
  it("deduplicates concurrent refunds and rejects conflicting fingerprints", async () => {
    const input = {
      transactionId: "TXN_A",
      amountMinor: 3000,
      reason: "Partial customer refund",
    };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        mutation("/api/refunds", input).set(
          "Idempotency-Key",
          "concurrent-refund-key",
        ),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await Refund.countDocuments({ transactionId: "TXN_A" })).toBe(1);
    expect(
      (await Payment.findOne({ transactionId: "TXN_A" }))?.reservedRefundMinor,
    ).toBe(3000);
    expect(
      (
        await mutation("/api/refunds", { ...input, amountMinor: 2000 }).set(
          "Idempotency-Key",
          "concurrent-refund-key",
        )
      ).status,
    ).toBe(409);
  });
  it("prevents overspending across different concurrent refund keys", async () => {
    const responses = await Promise.all(
      ["refund-second-a", "refund-second-b"].map((key) =>
        mutation("/api/refunds", {
          transactionId: "TXN_A",
          amountMinor: 5000,
          reason: "Another partial refund",
        }).set("Idempotency-Key", key),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await Payment.findOne({ transactionId: "TXN_A" }))?.reservedRefundMinor,
    ).toBe(8000);
  });
  it("verifies signed webhooks, deduplicates success and ignores terminal reversal", async () => {
    const refund = await Refund.findOne({
      idempotencyKey: "concurrent-refund-key",
    });
    async function webhook(eventId: string, type: string) {
      const data = {
        eventId,
        organization: "ORG_A",
        type,
        reference: refund!.refundId,
      };
      const raw = Buffer.from(JSON.stringify(data)),
        time = String(Math.floor(Date.now() / 1000));
      return request(app)
        .post("/api/webhooks/gateway")
        .set("Content-Type", "application/json")
        .set("X-Webhook-Timestamp", time)
        .set("X-Webhook-Signature", signWebhook(raw, time))
        .send(raw.toString());
    }
    expect((await webhook("EVT_TEST_REFUND", "refund.success")).status).toBe(
      200,
    );
    expect(
      (await webhook("EVT_TEST_REFUND", "refund.success")).body.duplicate,
    ).toBe(true);
    expect((await webhook("EVT_TEST_LATE", "refund.failed")).body.ignored).toBe(
      true,
    );
    const p = await Payment.findOne({ transactionId: "TXN_A" });
    expect(p?.refundedMinor).toBe(3000);
    expect(p?.reservedRefundMinor).toBe(5000);
    expect(p?.status).toBe("PARTIALLY_REFUNDED");
    expect(
      await Event.countDocuments({
        transactionId: "TXN_A",
        eventType: "REFUND_SUCCESS",
      }),
    ).toBe(1);
    expect(await Audit.countDocuments({ action: "REFUND_REQUESTED" })).toBe(2);
    expect(
      (await request(app).post("/api/webhooks/gateway").send({})).status,
    ).toBe(401);
  });
  it("creates payment and settlement jobs durably", async () => {
    const payment = await mutation("/api/transactions", {
      merchantId: "MER_A",
      customerReference: "CUS_NEW",
      amountMinor: 4999,
      paymentMethod: "CARD",
      outcome: "TIMEOUT",
    });
    expect(payment.status).toBe(201);
    expect(
      await Job.exists({
        kind: "PAYMENT",
        "payload.transactionId": payment.body.transactionId,
      }),
    ).toBeTruthy();
    const upload = await request(app)
      .post("/api/settlements/upload")
      .set("Origin", origin)
      .set("Cookie", admin.cookie)
      .set("X-CSRF-Token", admin.csrf)
      .attach(
        "file",
        Buffer.from(
          "transaction_id,merchant_id,amount_minor,settlement_amount_minor,status,settled_at\nTXN_A,MER_A,10000,9800,COMPLETED,2026-09-15T00:00:00Z\n",
        ),
        "test.csv",
      );
    expect(upload.status).toBe(202);
    expect(upload.body.state).toBe("QUEUED");
    const storedJob = await Job.findOne({ jobId: upload.body.jobId });
    for (let attempt = 0; attempt < 2; attempt++)
      await processSettlement(
        storedJob!.jobId,
        "ORG_A",
        storedJob!.payload.fileId,
        storedJob!.payload.settlementId,
      );
    expect(
      await SettlementRow.countDocuments({
        settlementId: storedJob!.payload.settlementId,
      }),
    ).toBe(1);
    expect(
      (
        await Settlement.findOne({
          settlementId: storedJob!.payload.settlementId,
        })
      )?.status,
    ).toBe("COMPLETED");
    expect(
      (
        await request(app)
          .get("/api/jobs/" + upload.body.jobId)
          .set("Cookie", other.cookie)
      ).status,
    ).toBe(404);
  });
  it("revokes logout sessions immediately", async () => {
    const temporary = await session("USR_A");
    expect((await mutation("/api/auth/logout", {}, temporary)).status).toBe(
      204,
    );
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", temporary.cookie))
        .status,
    ).toBe(401);
  });
  it("fails a missing upload cleanly without publishing settlement rows", async () => {
    await expect(
      processSettlement(
        "JOB_MISSING",
        "ORG_A",
        new mongoose.Types.ObjectId().toString(),
        "STL_MISSING",
      ),
    ).rejects.toThrow();
    expect(
      await SettlementRow.countDocuments({ settlementId: "STL_MISSING" }),
    ).toBe(0);
  });
});
