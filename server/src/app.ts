import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { z } from "zod";
import multer from "multer";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";
import { authenticate, createSession, originGuard, permit } from "./auth.js";
import {
  Audit,
  Event,
  Job,
  Merchant,
  Organization,
  Payment,
  Refund,
  Session,
  Settlement,
  SettlementRow,
  User,
  roles,
  statuses,
} from "./models.js";
import {
  amount,
  applyWebhook,
  refundInput,
  requestRefund,
  verifyWebhook,
  webhookInput,
} from "./finance.js";
import { AppError, errors, id, notFound, logger } from "./utils.js";
import { internal } from "./internal.js";

const paging = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const identifier = z
  .string()
  .regex(/^[A-Z]+_[A-Z0-9_]+$/)
  .max(100);
const credentials = z
  .object({
    email: z.email().toLowerCase().max(254),
    password: z
      .string()
      .min(12)
      .max(72)
      .refine(
        (value) => Buffer.byteLength(value, "utf8") <= 72,
        "Password must be at most 72 UTF-8 bytes",
      ),
  })
  .strict();
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  if (config.NODE_ENV === "production") app.set("trust proxy", 1);
  app.use(
    helmet(),
    cors({ origin: config.APP_ORIGIN, credentials: true }),
    cookieParser(),
  );
  app.use((req, res, next) => {
    const requestId = id("REQ");
    res.setHeader("X-Request-ID", requestId);
    const start = Date.now();
    res.on("finish", () =>
      logger.info(
        {
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        "HTTP",
      ),
    );
    next();
  });
  app.get("/health", (_req, res) => res.json({ status: "alive" }));
  app.get("/health/ready", async (_req, res) => {
    try {
      await mongoose.connection.db?.admin().ping();
      if (mongoose.connection.readyState !== 1)
        throw new Error("not connected");
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.post(
    "/api/webhooks/gateway",
    express.raw({ type: "application/json", limit: "64kb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new AppError(400, "BODY_INVALID", "JSON body required");
      verifyWebhook(
        req.body,
        String(req.headers["x-webhook-timestamp"] ?? ""),
        String(req.headers["x-webhook-signature"] ?? ""),
      );
      let body: unknown;
      try {
        body = JSON.parse(req.body.toString("utf8"));
      } catch {
        throw new AppError(400, "JSON_INVALID", "Malformed JSON");
      }
      res.json(await applyWebhook(webhookInput.parse(body)));
    },
  );
  app.use(express.json({ limit: "128kb" }), originGuard);
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const cookieOptions = {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 8 * 3600_000,
  };
  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const input = credentials.parse(req.body);
    const user = await User.findOne({ email: input.email }).select(
      "+passwordHash",
    );
    const valid = await bcrypt.compare(
      input.password,
      user?.passwordHash ??
        "$2b$12$eImiTXuWVxfM37uY4JANjQeSiAHCOO.eUS/IJnLlOYknVqBMdMoEu",
    );
    if (!user || !valid) {
      logger.warn({ event: "AUTH_FAILED" }, "Login rejected");
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect",
      );
    }
    const session = await createSession(user.userId);
    res
      .cookie("ll_session", session.token, cookieOptions)
      .json({ csrf: session.csrf });
  });
  app.post("/api/auth/demo", authLimiter, async (_req, res) => {
    if (config.ENABLE_DEMO !== "true")
      throw new AppError(404, "NOT_FOUND", "Demo is disabled");
    const user = await User.findOne({
      email: "demo@ledgerlens.dev",
      demo: true,
    });
    if (!user)
      throw new AppError(
        503,
        "DEMO_UNAVAILABLE",
        "Demo data has not been seeded",
      );
    const session = await createSession(user.userId);
    res
      .cookie("ll_session", session.token, cookieOptions)
      .json({ csrf: session.csrf });
  });
  app.use("/api", authenticate);
  app.get("/api/auth/me", async (req, res) => {
    const session = await Session.findOne({ sessionId: req.sessionId }).lean();
    const organization = await Organization.findOne({
      organization: req.actor.organization,
    }).lean();
    res.json({
      user: req.actor,
      organization: organization?.name,
      csrf: session?.csrf,
    });
  });
  app.post("/api/auth/logout", async (req, res) => {
    await Session.deleteOne({ sessionId: req.sessionId });
    res
      .clearCookie("ll_session", { ...cookieOptions, maxAge: undefined })
      .status(204)
      .end();
  });
  app.get("/api/merchants", async (req, res) => {
    const { page, limit } = paging.parse(req.query);
    const filter = { organization: req.actor.organization };
    const [items, total] = await Promise.all([
      Merchant.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Merchant.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  });
  app.post("/api/merchants", permit("ADMIN"), async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(2).max(100),
        email: z.email(),
        settlementAccountReference: z.string().min(3).max(100),
      })
      .strict()
      .parse(req.body);
    const merchant = await mongoose.connection.transaction(async (session) => {
      const [result] = await Merchant.create(
        [
          {
            ...input,
            merchantId: id("MER"),
            organization: req.actor.organization,
          },
        ],
        { session, ordered: true },
      );
      await Audit.create(
        [
          {
            auditId: id("AUD"),
            organization: req.actor.organization,
            actor: req.actor.userId,
            action: "MERCHANT_CREATED",
            entityType: "merchant",
            entityId: result!.merchantId,
          },
        ],
        { session, ordered: true },
      );
      return result;
    });
    res.status(201).json(merchant);
  });
  app.get("/api/transactions", async (req, res) => {
    const input = paging
      .extend({
        search: z.string().max(100).optional(),
        status: z.enum(statuses).optional(),
        merchantId: identifier.optional(),
        paymentMethod: z
          .enum(["CARD", "UPI", "NET_BANKING", "WALLET"])
          .optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        minAmount: z.coerce.number().int().min(0).max(1e12).optional(),
        maxAmount: z.coerce.number().int().min(0).max(1e12).optional(),
        sort: z
          .enum(["-createdAt", "createdAt", "amountMinor", "-amountMinor"])
          .default("-createdAt"),
      })
      .parse(req.query);
    const filter: Record<string, unknown> = {
      organization: req.actor.organization,
    };
    for (const field of ["status", "merchantId", "paymentMethod"] as const)
      if (input[field]) filter[field] = input[field];
    if (input.from || input.to)
      filter.createdAt = {
        ...(input.from ? { $gte: new Date(input.from) } : {}),
        ...(input.to ? { $lte: new Date(input.to) } : {}),
      };
    if (input.minAmount !== undefined || input.maxAmount !== undefined)
      filter.amountMinor = {
        ...(input.minAmount !== undefined ? { $gte: input.minAmount } : {}),
        ...(input.maxAmount !== undefined ? { $lte: input.maxAmount } : {}),
      };
    if (input.search) {
      const escaped = input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        "transactionId",
        "customerReference",
        "gatewayReference",
        "merchantId",
      ].map((field) => ({ [field]: { $regex: escaped, $options: "i" } }));
    }
    const [items, total] = await Promise.all([
      Payment.find(filter)
        .sort(input.sort + " _id")
        .skip((input.page - 1) * input.limit)
        .limit(input.limit)
        .maxTimeMS(5000)
        .lean(),
      Payment.countDocuments(filter).maxTimeMS(5000),
    ]);
    res.json({
      items,
      total,
      page: input.page,
      limit: input.limit,
      pages: Math.ceil(total / input.limit),
    });
  });
  app.post(
    "/api/transactions",
    permit("ADMIN", "ENGINEER"),
    async (req, res) => {
      const input = z
        .object({
          merchantId: identifier,
          customerReference: z.string().min(2).max(100),
          amountMinor: amount,
          paymentMethod: z.enum(["CARD", "UPI", "NET_BANKING", "WALLET"]),
          outcome: z.enum(["SUCCESS", "FAILED", "TIMEOUT"]).default("SUCCESS"),
        })
        .strict()
        .parse(req.body);
      const merchant = await Merchant.findOne({
        organization: req.actor.organization,
        merchantId: input.merchantId,
        status: "ACTIVE",
      });
      if (!merchant)
        throw new AppError(
          404,
          "MERCHANT_NOT_FOUND",
          "Active merchant was not found",
        );
      const payment = await mongoose.connection.transaction(async (session) => {
        const transactionId = id("TXN");
        const [result] = await Payment.create(
          [
            {
              ...input,
              transactionId,
              organization: req.actor.organization,
              gatewayReference: id("GW"),
              status: "PENDING",
              settlementDueAt: new Date(Date.now() + 2 * 86400_000),
            },
          ],
          { session, ordered: true },
        );
        await Event.create(
          ["PAYMENT_CREATED", "GATEWAY_REQUEST_SENT"].map((eventType) => ({
            eventId: id("EVT"),
            organization: req.actor.organization,
            transactionId,
            eventType,
            source: "api",
          })),
          { session, ordered: true },
        );
        await Job.create(
          [
            {
              jobId: id("JOB"),
              organization: req.actor.organization,
              kind: "PAYMENT",
              payload: { transactionId, outcome: input.outcome },
              createdBy: req.actor.userId,
            },
          ],
          { session, ordered: true },
        );
        await Audit.create(
          [
            {
              auditId: id("AUD"),
              organization: req.actor.organization,
              actor: req.actor.userId,
              action: "PAYMENT_CREATED",
              entityType: "transaction",
              entityId: transactionId,
            },
          ],
          { session, ordered: true },
        );
        return result;
      });
      res.status(201).json(payment);
    },
  );
  app.get("/api/transactions/:transactionId", async (req, res) => {
    const transactionId = identifier.parse(req.params.transactionId),
      filter = { organization: req.actor.organization, transactionId };
    const payment = await Payment.findOne(filter).lean();
    if (!payment)
      throw new AppError(
        404,
        "TRANSACTION_NOT_FOUND",
        "Transaction was not found",
      );
    const [events, refunds, settlements, audit, merchant] = await Promise.all([
      Event.find(filter).sort({ timestamp: 1 }).limit(500).lean(),
      Refund.find(filter).sort({ createdAt: -1 }).limit(100).lean(),
      SettlementRow.find(filter).limit(100).lean(),
      Audit.find({
        organization: req.actor.organization,
        entityId: transactionId,
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Merchant.findOne({
        organization: req.actor.organization,
        merchantId: payment.merchantId,
      }).lean(),
    ]);
    res.json({ ...payment, merchant, events, refunds, settlements, audit });
  });
  app.post("/api/refunds", permit("ADMIN", "FINANCE"), async (req, res) => {
    const key = z
      .string()
      .min(8)
      .max(128)
      .regex(/^[\w-]+$/)
      .parse(req.headers["idempotency-key"]);
    res
      .status(201)
      .json(await requestRefund(req.actor, refundInput.parse(req.body), key));
  });
  app.get("/api/refunds", async (req, res) => {
    const { page, limit } = paging.parse(req.query);
    const filter = { organization: req.actor.organization };
    const [items, total] = await Promise.all([
      Refund.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Refund.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
  });
  const upload = multer({
    dest: tmpdir(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
  });
  app.post(
    "/api/settlements/upload",
    permit("ADMIN", "FINANCE"),
    upload.single("file"),
    async (req, res) => {
      const file = req.file;
      if (!file) throw new AppError(422, "FILE_REQUIRED", "Choose a CSV file");
      let fileId: mongoose.Types.ObjectId | undefined;
      try {
        if (!file.originalname.toLowerCase().endsWith(".csv"))
          throw new AppError(422, "CSV_REQUIRED", "Upload a CSV file");
        const bucket = new mongoose.mongo.GridFSBucket(
          mongoose.connection.db!,
          { bucketName: "uploads" },
        );
        const stream = bucket.openUploadStream(id("CSV"), {
          metadata: { organization: req.actor.organization },
        });
        fileId = stream.id;
        await pipeline(createReadStream(file.path), stream);
        const job = await mongoose.connection.transaction(async (session) => {
          const [result] = await Job.create(
            [
              {
                jobId: id("JOB"),
                organization: req.actor.organization,
                kind: "SETTLEMENT",
                payload: { fileId: String(fileId), settlementId: id("STL") },
                createdBy: req.actor.userId,
              },
            ],
            { session, ordered: true },
          );
          await Audit.create(
            [
              {
                auditId: id("AUD"),
                organization: req.actor.organization,
                actor: req.actor.userId,
                action: "SETTLEMENT_UPLOADED",
                entityType: "job",
                entityId: result!.jobId,
                metadata: { bytes: file.size },
              },
            ],
            { session, ordered: true },
          );
          return result;
        });
        res.status(202).json(job);
      } catch (error) {
        if (fileId)
          await new mongoose.mongo.GridFSBucket(mongoose.connection.db!, {
            bucketName: "uploads",
          })
            .delete(fileId)
            .catch(() => {});
        throw error;
      } finally {
        await unlink(file.path).catch(() => {});
      }
    },
  );
  app.get("/api/settlements", async (req, res) => {
    const { page, limit } = paging.parse(req.query),
      filter = { organization: req.actor.organization };
    const [items, total, jobs] = await Promise.all([
      Settlement.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Settlement.countDocuments(filter),
      Job.find({ ...filter, kind: "SETTLEMENT" })
        .select("-payload")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);
    res.json({
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      jobs,
    });
  });
  app.get("/api/jobs/:jobId", async (req, res) => {
    const job = await Job.findOne({
      organization: req.actor.organization,
      jobId: identifier.parse(req.params.jobId),
    })
      .select("-payload")
      .lean();
    if (!job) throw new AppError(404, "JOB_NOT_FOUND", "Job was not found");
    res.json(job);
  });
  app.post(
    "/api/jobs/:jobId/retry",
    permit("ADMIN", "FINANCE", "ENGINEER"),
    async (req, res) => {
      const job = await Job.findOneAndUpdate(
        {
          organization: req.actor.organization,
          jobId: identifier.parse(req.params.jobId),
          state: "FAILED",
        },
        { $set: { state: "QUEUED", error: null, attempts: 0 } },
        { new: true },
      );
      if (!job)
        throw new AppError(
          409,
          "JOB_NOT_RETRYABLE",
          "Failed job was not found",
        );
      res.status(202).json({ jobId: job.jobId, state: job.state });
    },
  );
  app.post(
    "/api/reconciliation/run",
    permit("ADMIN", "FINANCE", "ENGINEER"),
    async (req, res) => {
      const job = await Job.create({
        jobId: id("JOB"),
        organization: req.actor.organization,
        kind: "RECONCILE",
        payload: {},
        createdBy: req.actor.userId,
      });
      res.status(202).json({ jobId: job.jobId, state: job.state });
    },
  );
  app.get("/api/incidents", async (req, res) => {
    const q = paging
      .extend({
        status: z
          .enum(["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED"])
          .optional(),
        search: z.string().max(100).optional(),
        transactionId: identifier.optional(),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      })
      .parse(req.query);
    const query = new URLSearchParams(
      Object.entries(q)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    res.json(
      await internal("/api/incidents/?" + query, req.actor.organization),
    );
  });
  app.get("/api/incidents/:incidentId", async (req, res) => {
    const incidentId = z.string().uuid().parse(req.params.incidentId);
    res.json(
      await internal(`/api/incidents/${incidentId}/`, req.actor.organization),
    );
  });
  app.patch(
    "/api/incidents/:incidentId",
    permit("ADMIN", "OPERATIONS", "FINANCE"),
    async (req, res) => {
      const incidentId = z.string().uuid().parse(req.params.incidentId);
      const input = z
        .object({
          status: z
            .enum(["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED"])
            .optional(),
          note: z.string().trim().min(1).max(2000).optional(),
          assignedToReference: z.string().max(100).optional(),
        })
        .strict()
        .parse(req.body);
      if (
        input.assignedToReference &&
        !(await User.exists({
          organization: req.actor.organization,
          userId: input.assignedToReference,
        }))
      )
        throw new AppError(
          422,
          "ASSIGNEE_INVALID",
          "Choose a member of your organization",
        );
      res.json(
        await internal(
          `/api/incidents/${incidentId}/`,
          req.actor.organization,
          {
            method: "PATCH",
            body: input,
            actor: req.actor.userId,
            role: req.actor.role,
          },
        ),
      );
    },
  );
  app.get("/api/analytics/:report", async (req, res) => {
    const report = z
      .enum([
        "overview",
        "reconciliation",
        "payment-health",
        "refund-health",
        "settlement-health",
      ])
      .parse(req.params.report);
    res.json(
      await internal(`/api/analytics/${report}/`, req.actor.organization),
    );
  });
  app.get("/api/analytics/merchant/:merchantId", async (req, res) =>
    res.json(
      await internal(
        `/api/analytics/merchant/${identifier.parse(req.params.merchantId)}/`,
        req.actor.organization,
      ),
    ),
  );
  app.get("/api/audit", async (req, res) => {
    const { page, limit } = paging.parse(req.query),
      filter = { organization: req.actor.organization };
    const [items, total] = await Promise.all([
      Audit.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Audit.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
  });
  app.get("/api/users", async (req, res) =>
    res.json({
      items: await User.find({ organization: req.actor.organization })
        .select("userId name email role demo")
        .limit(100)
        .lean(),
    }),
  );
  app.post("/api/users", permit("ADMIN"), async (req, res) => {
    const input = credentials
      .extend({ name: z.string().trim().min(2).max(100), role: z.enum(roles) })
      .parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await mongoose.connection.transaction(async (session) => {
      const [result] = await User.create(
        [
          {
            userId: id("USR"),
            organization: req.actor.organization,
            name: input.name,
            email: input.email,
            role: input.role,
            passwordHash,
          },
        ],
        { session, ordered: true },
      );
      await Audit.create(
        [
          {
            auditId: id("AUD"),
            organization: req.actor.organization,
            actor: req.actor.userId,
            action: "USER_CREATED",
            entityType: "user",
            entityId: result!.userId,
          },
        ],
        { session, ordered: true },
      );
      return result!;
    });
    res.status(201).json({
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  });
  app.patch("/api/users/:userId", permit("ADMIN"), async (req, res) => {
    const userId = identifier.parse(req.params.userId),
      { role } = z
        .object({ role: z.enum(roles) })
        .strict()
        .parse(req.body);
    if (userId === req.actor.userId)
      throw new AppError(
        409,
        "SELF_ROLE_CHANGE",
        "An administrator cannot change their own role",
      );
    const user = await mongoose.connection.transaction(async (session) => {
      const result = await User.findOneAndUpdate(
        { organization: req.actor.organization, userId, demo: false },
        { $set: { role } },
        { session, new: true },
      );
      if (!result)
        throw new AppError(
          404,
          "USER_NOT_FOUND",
          "Editable user was not found",
        );
      await Audit.create(
        [
          {
            auditId: id("AUD"),
            organization: req.actor.organization,
            actor: req.actor.userId,
            action: "ROLE_CHANGED",
            entityType: "user",
            entityId: userId,
            metadata: { role },
          },
        ],
        { session, ordered: true },
      );
      return result;
    });
    res.json({ userId: user.userId, role: user.role });
  });
  app.use(notFound, errors);
  return app;
}
