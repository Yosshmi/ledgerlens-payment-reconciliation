from copy import deepcopy
from datetime import timedelta

from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from reconciliation.models import Incident, PaymentProjection
from reconciliation.rules import evaluate
from reconciliation.services import reconcile_batch


def payment():
    now = timezone.now()
    return {
        "transactionId": "TXN_TEST001",
        "merchantId": "MER_TEST001",
        "amountMinor": 10000,
        "currency": "INR",
        "status": "SUCCESS",
        "paymentMethod": "UPI",
        "createdAt": now - timedelta(days=3),
        "sourceUpdatedAt": now,
        "settlementDueAt": now - timedelta(days=1),
        "ledgerDebitMinor": 10000,
        "merchantCreditMinor": 10000,
        "refundedMinor": 0,
        "refundLedgerMinor": 0,
        "settlements": [],
        "refunds": [],
    }


class RulesTests(SimpleTestCase):
    def test_missing_settlement_grace_period(self):
        p = payment()
        self.assertEqual(evaluate(p, timezone.now())[0]["type"], "MISSING_SETTLEMENT")
        p["settlementDueAt"] = timezone.now() + timedelta(days=1)
        self.assertEqual(evaluate(p, timezone.now()), [])

    def test_fees_do_not_create_false_amount_mismatch(self):
        p = payment()
        p["settlements"] = [
            {"amountMinor": 10000, "settlementAmountMinor": 9750, "status": "COMPLETED"}
        ]
        self.assertEqual(evaluate(p, timezone.now()), [])

    def test_all_mismatch_rules(self):
        p = payment()
        p.update(ledgerDebitMinor=0, merchantCreditMinor=0, refundedMinor=15000)
        p["refunds"] = [{"amountMinor": 16000, "status": "SUCCESS"}]
        p["settlements"] = [
            {"amountMinor": 9000, "status": "FAILED"},
            {"amountMinor": 9000, "status": "COMPLETED"},
        ]
        kinds = {r["type"] for r in evaluate(p, timezone.now())}
        self.assertEqual(
            kinds,
            {
                "AMOUNT_MISMATCH",
                "MISSING_LEDGER_DEBIT",
                "MISSING_MERCHANT_CREDIT",
                "DUPLICATE_TRANSACTION",
                "REFUND_LEDGER_MISMATCH",
                "REFUND_AMOUNT_MISMATCH",
                "SETTLEMENT_STATUS_MISMATCH",
            },
        )

    def test_failed_refunds_do_not_count_as_refunded(self):
        p = payment()
        p["refunds"] = [{"amountMinor": 5000, "status": "FAILED"}]
        self.assertFalse(any(r["type"].startswith("REFUND") for r in evaluate(p, timezone.now())))


@override_settings(INTERNAL_SERVICE_SECRET="test-service-secret")
class ServiceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.credentials(
            HTTP_AUTHORIZATION="Bearer test-service-secret",
            HTTP_X_ORGANIZATION="ORG_TEST",
            HTTP_X_ACTOR="USR_TEST",
            HTTP_X_ROLE="FINANCE",
        )

    def test_retries_are_idempotent_and_tenant_scoped(self):
        p = payment()
        reconcile_batch("ORG_TEST", [p])
        reconcile_batch("ORG_TEST", [p])
        reconcile_batch("ORG_OTHER", [p])
        self.assertEqual(Incident.objects.count(), 2)
        response = self.client.get("/api/incidents/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)
        other = Incident.objects.get(organization="ORG_OTHER")
        self.assertEqual(self.client.get(f"/api/incidents/{other.pk}/").status_code, 404)

    def test_stale_projection_does_not_overwrite_newer_state(self):
        p = payment()
        reconcile_batch("ORG_TEST", [p])
        stale = deepcopy(p)
        stale["sourceUpdatedAt"] -= timedelta(days=1)
        stale["amountMinor"] = 1
        reconcile_batch("ORG_TEST", [stale])
        self.assertEqual(PaymentProjection.objects.get().amount_minor, 10000)

    def test_incident_disposition_requires_note_and_audits_actor(self):
        reconcile_batch("ORG_TEST", [payment()])
        issue = Incident.objects.get()
        url = f"/api/incidents/{issue.pk}/"
        self.assertEqual(
            self.client.patch(url, {"status": "RESOLVED"}, format="json").status_code, 400
        )
        response = self.client.patch(
            url, {"status": "RESOLVED", "note": "Confirmed with gateway"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["activity"][-1]["actor"], "USR_TEST")

    def test_analytics_is_derived_from_tenant_data(self):
        reconcile_batch("ORG_TEST", [payment()])
        reconcile_batch("ORG_OTHER", [payment()])
        data = self.client.get("/api/analytics/overview/").json()
        self.assertEqual(data["transactions"], 1)
        self.assertEqual(data["volumeMinor"], 10000)
        self.assertEqual(data["openIncidents"], 1)

    def test_authentication_and_role_enforced(self):
        self.client.credentials()
        self.assertEqual(self.client.get("/api/incidents/").status_code, 401)
        self.client.credentials(
            HTTP_AUTHORIZATION="Bearer test-service-secret",
            HTTP_X_ORGANIZATION="ORG_TEST",
            HTTP_X_ROLE="VIEWER",
        )
        reconcile_batch("ORG_TEST", [payment()])
        issue = Incident.objects.get()
        self.assertEqual(
            self.client.patch(
                f"/api/incidents/{issue.pk}/", {"note": "test"}, format="json"
            ).status_code,
            403,
        )
        self.assertEqual(self.client.post("/api/reconcile/", {}, format="json").status_code, 403)
