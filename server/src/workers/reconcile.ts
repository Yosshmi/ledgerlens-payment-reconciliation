import { Payment, Refund, Settlement, SettlementRow } from "../models.js";
import { internal } from "../internal.js";
export async function reconcile(organization: string, transactionId?: string) {
  const cursor = Payment.find({
    organization,
    ...(transactionId ? { transactionId } : {}),
  })
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize: 250 });
  let batch: Array<Awaited<ReturnType<typeof cursor.next>>> = [];
  async function flush() {
    const payments = batch.filter((p) => p !== null),
      ids = payments.map((p) => p.transactionId);
    const [rows, refunds] = await Promise.all([
      SettlementRow.find({ organization, transactionId: { $in: ids } }).lean(),
      Refund.find({ organization, transactionId: { $in: ids } }).lean(),
    ]);
    const settlements = await Settlement.find({
      organization,
      settlementId: { $in: [...new Set(rows.map((r) => r.settlementId))] },
      status: { $in: ["COMPLETED", "FAILED"] },
    })
      .select("settlementId")
      .lean();
    const finalIds = new Set(settlements.map((s) => s.settlementId));
    const rowMap = new Map<string, typeof rows>(),
      refundMap = new Map<string, typeof refunds>();
    for (const row of rows) {
      if (finalIds.has(row.settlementId))
        rowMap.set(row.transactionId, [
          ...(rowMap.get(row.transactionId) ?? []),
          row,
        ]);
    }
    for (const refund of refunds)
      refundMap.set(refund.transactionId, [
        ...(refundMap.get(refund.transactionId) ?? []),
        refund,
      ]);
    await internal("/api/reconcile/", organization, {
      method: "POST",
      body: {
        payments: payments.map((p) => ({
          transactionId: p.transactionId,
          merchantId: p.merchantId,
          amountMinor: p.amountMinor,
          currency: p.currency,
          status: p.status,
          paymentMethod: p.paymentMethod,
          createdAt: p.createdAt.toISOString(),
          sourceUpdatedAt: p.updatedAt.toISOString(),
          settlementDueAt: p.settlementDueAt.toISOString(),
          ledgerDebitMinor: p.ledgerDebitMinor,
          merchantCreditMinor: p.merchantCreditMinor,
          refundedMinor: p.refundedMinor,
          refundLedgerMinor: p.refundLedgerMinor,
          settlements: (rowMap.get(p.transactionId) ?? []).map((r) => ({
            amountMinor: r.amountMinor,
            settlementAmountMinor: r.settlementAmountMinor,
            status: r.status,
          })),
          refunds: (refundMap.get(p.transactionId) ?? []).map((r) => ({
            amountMinor: r.amountMinor,
            status: r.status,
          })),
        })),
      },
    });
    batch = [];
  }
  for await (const payment of cursor) {
    batch.push(payment);
    if (batch.length === 250) await flush();
  }
  if (batch.length) await flush();
}
