import mongoose from "mongoose";
import { parse } from "csv-parse";
import { z } from "zod";
import {
  Job,
  Merchant,
  Payment,
  Settlement,
  SettlementRow,
} from "../models.js";
const columns = [
  "transaction_id",
  "merchant_id",
  "amount_minor",
  "settlement_amount_minor",
  "status",
  "settled_at",
];
const integer = z
  .string()
  .regex(/^\d{1,13}$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(1e12));
const rowSchema = z
  .object({
    transaction_id: z.string().regex(/^TXN_[A-Z0-9_]+$/),
    merchant_id: z.string().regex(/^MER_[A-Z0-9_]+$/),
    amount_minor: integer,
    settlement_amount_minor: integer,
    status: z.enum(["COMPLETED", "FAILED", "PENDING"]),
    settled_at: z.iso.datetime(),
  })
  .strict();
function rows(fileId: string) {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db!, {
    bucketName: "uploads",
  });
  return bucket.openDownloadStream(new mongoose.Types.ObjectId(fileId)).pipe(
    parse({
      bom: true,
      skip_empty_lines: true,
      max_record_size: 4096,
      columns: (header: string[]) => {
        if (header.join(",") !== columns.join(","))
          throw new Error("CSV headers must match the documented template");
        return header;
      },
    }),
  );
}
export async function processSettlement(
  jobId: string,
  organization: string,
  fileId: string,
  settlementId: string,
) {
  let rowNumber = 0,
    merchantId = "",
    gross = 0,
    net = 0,
    allComplete = true;
  // First pass validates the entire file before any financial rows become visible.
  let batch: Array<z.infer<typeof rowSchema>> = [];
  async function validateBatch() {
    const ids = batch.map((r) => r.transaction_id);
    const found = await Payment.find({
      organization,
      merchantId,
      transactionId: { $in: ids },
    })
      .select("transactionId")
      .lean();
    const allowed = new Set(found.map((p) => p.transactionId));
    if (batch.some((r) => !allowed.has(r.transaction_id)))
      throw new Error(
        "CSV contains an unknown transaction or a merchant mismatch",
      );
    batch = [];
  }
  for await (const raw of rows(fileId)) {
    const row = rowSchema.parse(raw);
    rowNumber++;
    if (rowNumber > 50_000) throw new Error("CSV exceeds 50,000 rows");
    if (!merchantId) merchantId = row.merchant_id;
    if (row.merchant_id !== merchantId)
      throw new Error("Each file must contain one merchant");
    gross += row.amount_minor;
    net += row.settlement_amount_minor;
    if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(net))
      throw new Error("CSV totals exceed safe integer range");
    if (row.status !== "COMPLETED") allComplete = false;
    batch.push(row);
    if (batch.length === 250) await validateBatch();
  }
  if (batch.length) await validateBatch();
  if (!rowNumber) throw new Error("CSV contains no data rows");
  if (!(await Merchant.exists({ organization, merchantId })))
    throw new Error("Merchant was not found");
  if (net > gross)
    throw new Error("Settlement net amount exceeds gross amount");
  const existing = await Settlement.findOne({ organization, settlementId });
  if (existing?.status === "COMPLETED") return;
  await Settlement.updateOne(
    { organization, settlementId },
    {
      $set: {
        merchantId,
        period: new Date().toISOString().slice(0, 10),
        grossAmountMinor: gross,
        feesMinor: gross - net,
        netAmountMinor: net,
        transactionCount: rowNumber,
        status: "PROCESSING",
      },
    },
    { upsert: true },
  );
  let index = 0;
  let operations: Parameters<typeof SettlementRow.bulkWrite>[0] = [];
  for await (const raw of rows(fileId)) {
    const row = rowSchema.parse(raw);
    index++;
    operations.push({
      updateOne: {
        filter: { organization, settlementId, rowNumber: index },
        update: {
          $set: {
            transactionId: row.transaction_id,
            merchantId: row.merchant_id,
            amountMinor: row.amount_minor,
            settlementAmountMinor: row.settlement_amount_minor,
            status: row.status,
            settledAt: new Date(row.settled_at),
          },
        },
        upsert: true,
      },
    });
    if (operations.length === 250) {
      await SettlementRow.bulkWrite(operations);
      operations = [];
      await Job.updateOne(
        { jobId },
        { $set: { progress: Math.floor((index / rowNumber) * 90) } },
      );
    }
  }
  if (operations.length) await SettlementRow.bulkWrite(operations);
  await mongoose.connection.transaction(async (session) => {
    await Settlement.updateOne(
      { organization, settlementId },
      {
        $set: {
          status: allComplete ? "COMPLETED" : "FAILED",
          completedAt: new Date(),
        },
      },
      { session },
    );
    await Job.updateOne({ jobId }, { $set: { progress: 95 } }, { session });
  });
}
