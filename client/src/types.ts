export type User = {
  userId: string;
  name: string;
  email: string;
  role: string;
  demo: boolean;
};
export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};
export type Merchant = {
  merchantId: string;
  name: string;
  email: string;
  status: string;
  settlementAccountReference: string;
};
export type Payment = {
  transactionId: string;
  merchantId: string;
  amountMinor: number;
  currency: string;
  status: string;
  paymentMethod: string;
  createdAt: string;
  updatedAt: string;
  customerReference: string;
  gateway: string;
  gatewayReference: string;
  refundedMinor: number;
  reservedRefundMinor: number;
  ledgerDebitMinor: number;
  merchantCreditMinor: number;
  refundLedgerMinor: number;
  settlementDueAt: string;
};
export type Refund = {
  refundId: string;
  transactionId: string;
  amountMinor: number;
  reason: string;
  status: string;
  createdAt: string;
};
export type Event = {
  eventId: string;
  eventType: string;
  timestamp: string;
  source: string;
  metadata: Record<string, unknown>;
  correlationId?: string;
};
export type Audit = {
  auditId: string;
  actor: string;
  action: string;
  entityId: string;
  entityType: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};
export type Settlement = {
  settlementId: string;
  merchantId: string;
  period: string;
  grossAmountMinor: number;
  feesMinor: number;
  netAmountMinor: number;
  transactionCount: number;
  status: string;
  createdAt: string;
};
export type Job = {
  jobId: string;
  state: string;
  progress: number;
  error?: string;
  createdAt: string;
};
export type Incident = {
  incident_id: string;
  transaction_id: string;
  merchant_id: string;
  type: string;
  severity: string;
  expected_value: number;
  actual_value: number;
  difference: number;
  status: string;
  detected_at: string;
  resolved_at: string | null;
  assigned_to_reference: string;
  condition_present: boolean;
  activity?: {
    actor: string;
    action: string;
    note: string;
    created_at: string;
    metadata: Record<string, unknown>;
  }[];
};
export type Analytics = {
  transactions: number;
  volumeMinor: number;
  refundedMinor: number;
  success: number;
  failed: number;
  settled: number;
  refundCount: number;
  failedRefundCount: number;
  successRate: number;
  openIncidents: number;
  criticalIncidents: number;
  resolvedIncidents: number;
  mismatchRate: number;
  settlementRate: number;
  refundRate: number;
  lastReconciledAt: string | null;
  daily: { date: string; count: number; volumeMinor: number; failed: number }[];
  methods: { payment_method: string; count: number }[];
  merchants: { merchant_id: string; count: number; volumeMinor: number }[];
  incidentTypes: { type: string; count: number }[];
};
