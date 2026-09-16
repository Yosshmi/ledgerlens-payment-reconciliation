import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone

from .models import Incident, IncidentActivity, PaymentProjection
from .rules import evaluate


@transaction.atomic
def reconcile_batch(organization, payments):
    count = 0
    for payment in payments:
        projection, _ = PaymentProjection.objects.get_or_create(
            organization=organization,
            transaction_id=payment["transactionId"],
            defaults={
                "merchant_id": payment["merchantId"],
                "amount_minor": payment["amountMinor"],
                "status": payment["status"],
                "payment_method": payment["paymentMethod"],
                "created_at": payment["createdAt"],
                "source_updated_at": payment["sourceUpdatedAt"],
            },
        )
        projection = PaymentProjection.objects.select_for_update().get(pk=projection.pk)
        if projection.source_updated_at > payment["sourceUpdatedAt"]:
            continue
        projection.merchant_id = payment["merchantId"]
        projection.amount_minor = payment["amountMinor"]
        projection.status = payment["status"]
        projection.payment_method = payment["paymentMethod"]
        projection.refunded_minor = payment["refundedMinor"]
        projection.settlement_count = len(payment["settlements"])
        projection.settlement_completed = bool(payment["settlements"]) and all(
            s["status"] == "COMPLETED" for s in payment["settlements"]
        )
        projection.refund_count = len(payment["refunds"])
        projection.failed_refund_count = sum(r["status"] == "FAILED" for r in payment["refunds"])
        projection.source_updated_at = payment["sourceUpdatedAt"]
        projection.snapshot = json.loads(json.dumps(payment, cls=DjangoJSONEncoder))
        projection.save()
        findings = evaluate(payment, timezone.now())
        active_types = []
        for finding in findings:
            active_types.append(finding["type"])
            incident, created = Incident.objects.get_or_create(
                organization=organization,
                transaction_id=payment["transactionId"],
                type=finding["type"],
                defaults={**finding, "merchant_id": payment["merchantId"]},
            )
            if created:
                IncidentActivity.objects.create(
                    incident=incident, actor="SYSTEM", action="DETECTED"
                )
            else:
                was_present = incident.condition_present
                for key, value in finding.items():
                    setattr(incident, key, value)
                incident.condition_present = True
                if not was_present and incident.status == "RESOLVED":
                    incident.status = "OPEN"
                    incident.resolved_at = None
                    IncidentActivity.objects.create(
                        incident=incident, actor="SYSTEM", action="REOPENED"
                    )
                incident.save()
            count += 1
        # Clearing a condition does not silently overwrite a human disposition.
        Incident.objects.filter(
            organization=organization, transaction_id=payment["transactionId"]
        ).exclude(type__in=active_types).update(condition_present=False)
    return count
