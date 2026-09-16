from datetime import datetime

SUCCESS_STATES = {"SUCCESS", "REFUNDED", "PARTIALLY_REFUNDED"}


def evaluate(payment, now):
    """Pure integer-only comparisons; fees do not change the gross payment match."""
    findings = []

    def add(kind, expected, actual, severity="HIGH"):
        findings.append(
            {
                "type": kind,
                "severity": severity,
                "expected_value": expected,
                "actual_value": actual,
                "difference": actual - expected,
            }
        )

    amount = payment["amountMinor"]
    settlements = payment["settlements"]
    if payment["status"] in SUCCESS_STATES:
        due = payment["settlementDueAt"]
        if isinstance(due, str):
            due = datetime.fromisoformat(due.replace("Z", "+00:00"))
        if not settlements and now >= due:
            add("MISSING_SETTLEMENT", amount, 0)
        if settlements:
            gross = sum(s["amountMinor"] for s in settlements)
            if gross != amount:
                add("AMOUNT_MISMATCH", amount, gross)
            if any(s["status"] != "COMPLETED" for s in settlements):
                add(
                    "SETTLEMENT_STATUS_MISMATCH",
                    len(settlements),
                    sum(s["status"] == "COMPLETED" for s in settlements),
                    "MEDIUM",
                )
        if payment["ledgerDebitMinor"] != amount:
            add("MISSING_LEDGER_DEBIT", amount, payment["ledgerDebitMinor"], "CRITICAL")
        if payment["merchantCreditMinor"] != amount:
            add("MISSING_MERCHANT_CREDIT", amount, payment["merchantCreditMinor"], "CRITICAL")
    elif settlements and any(s["status"] == "COMPLETED" for s in settlements):
        add("SETTLEMENT_STATUS_MISMATCH", 0, len(settlements))
    if len(settlements) > 1:
        add("DUPLICATE_TRANSACTION", 1, len(settlements), "CRITICAL")
    refunded = sum(r["amountMinor"] for r in payment["refunds"] if r["status"] == "SUCCESS")
    if refunded != payment["refundLedgerMinor"]:
        add("REFUND_LEDGER_MISMATCH", refunded, payment["refundLedgerMinor"])
    if refunded != payment["refundedMinor"] or refunded > amount:
        add("REFUND_AMOUNT_MISMATCH", min(payment["refundedMinor"], amount), refunded)
    return findings
