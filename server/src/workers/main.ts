import mongoose from "mongoose";
import { Queue, Worker } from "bullmq";
import { config } from "../config.js";
import { connect, Job, Organization } from "../models.js";
import { logger } from "../utils.js";
import { signWebhook, webhookInput } from "../finance.js";
import type { z } from "zod";
import { processSettlement } from "./settlement.js";
import { reconcile } from "./reconcile.js";
await connect();
async function deliverWebhook(payload: z.infer<typeof webhookInput>) {
  const raw = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(
    `${config.API_INTERNAL_URL}/api/webhooks/gateway`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Timestamp": timestamp,
        "X-Webhook-Signature": signWebhook(raw, timestamp),
      },
      body: raw,
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(`Gateway delivery failed (${response.status})`);
}
const redis = new URL(config.REDIS_URL);
const connection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: redis.username || undefined,
  password: redis.password || undefined,
  ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
};
const queue = new Queue("ledgerlens", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 7 * 86400 },
  },
});
const worker = new Worker(
  "ledgerlens",
  async (queued) => {
    const job = await Job.findOne({ jobId: queued.data.jobId });
    if (!job || job.state === "COMPLETED") return;
    await Job.updateOne(
      { jobId: job.jobId },
      { $set: { state: "PROCESSING", error: null }, $inc: { attempts: 1 } },
    );
    try {
      if (job.kind === "PAYMENT" && job.payload.outcome !== "TIMEOUT")
        await deliverWebhook({
          eventId: `EVT_${job.jobId}`,
          organization: job.organization,
          type:
            job.payload.outcome === "SUCCESS"
              ? "payment.success"
              : "payment.failed",
          reference: job.payload.transactionId,
        });
      if (job.kind === "REFUND")
        await deliverWebhook({
          eventId: `EVT_${job.jobId}`,
          organization: job.organization,
          type:
            job.payload.outcome === "FAILED"
              ? "refund.failed"
              : "refund.success",
          reference: job.payload.refundId,
        });
      if (job.kind === "SETTLEMENT") {
        await processSettlement(
          job.jobId,
          job.organization,
          job.payload.fileId,
          job.payload.settlementId,
        );
        await reconcile(job.organization);
      }
      if (job.kind === "RECONCILE")
        await reconcile(job.organization, job.payload.transactionId);
      await Job.updateOne(
        { jobId: job.jobId },
        { $set: { state: "COMPLETED", progress: 100 } },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job failed";
      await Job.updateOne(
        { jobId: job.jobId },
        {
          $set: {
            state: queued.attemptsMade + 1 >= 5 ? "FAILED" : "QUEUED",
            error: message.slice(0, 500),
          },
        },
      );
      throw error;
    }
  },
  { connection, concurrency: 1 },
);
worker.on("error", (err) =>
  logger.error({ message: err.message }, "Worker error"),
);
worker.on("failed", (job, err) =>
  logger.warn({ jobId: job?.id, message: err.message }, "Job attempt failed"),
);
let dispatching = false;
async function dispatch() {
  if (dispatching) return;
  dispatching = true;
  try {
    const jobs = await Job.find({ state: { $in: ["QUEUED", "PROCESSING"] } })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();
    for (const job of jobs) {
      const existing = await queue.getJob(job.jobId);
      if (
        existing &&
        (await existing.getState()) === "failed" &&
        job.state === "QUEUED"
      )
        await existing.retry();
      else if (!existing)
        await queue.add(job.kind, { jobId: job.jobId }, { jobId: job.jobId });
    }
  } catch (error) {
    logger.warn(
      { message: error instanceof Error ? error.message : "Queue unavailable" },
      "Outbox dispatch will retry",
    );
  } finally {
    dispatching = false;
  }
}
const timer = setInterval(() => void dispatch(), 3000);
await dispatch();
// A periodic projection refresh also catches newly overdue missing settlements.
const sweep = setInterval(
  () =>
    void (async () => {
      for (const org of await Organization.find().lean())
        await Job.updateOne(
          {
            jobId: `JOB_SWEEP_${org.organization}_${Math.floor(Date.now() / 3600000)}`,
          },
          {
            $setOnInsert: {
              organization: org.organization,
              kind: "RECONCILE",
              payload: {},
              state: "QUEUED",
            },
          },
          { upsert: true },
        );
    })().catch((err) => logger.error({ message: String(err) }, "Sweep failed")),
  60_000,
);
logger.info("Worker started");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    clearInterval(sweep);
    void worker
      .close()
      .then(() => queue.close())
      .then(() => mongoose.disconnect())
      .then(() => process.exit(0));
  });
