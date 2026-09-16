import uuid

from django.db import models


class PaymentProjection(models.Model):
    organization = models.CharField(max_length=100)
    transaction_id = models.CharField(max_length=100)
    merchant_id = models.CharField(max_length=100)
    amount_minor = models.BigIntegerField()
    currency = models.CharField(max_length=3, default="INR")
    status = models.CharField(max_length=30)
    payment_method = models.CharField(max_length=30)
    refunded_minor = models.BigIntegerField(default=0)
    settlement_count = models.PositiveIntegerField(default=0)
    settlement_completed = models.BooleanField(default=False)
    refund_count = models.PositiveIntegerField(default=0)
    failed_refund_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField()
    source_updated_at = models.DateTimeField()
    reconciled_at = models.DateTimeField(auto_now=True)
    snapshot = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "transaction_id"], name="unique_tenant_payment"
            )
        ]
        indexes = [
            models.Index(fields=["organization", "created_at"]),
            models.Index(fields=["organization", "merchant_id"]),
            models.Index(fields=["organization", "status"]),
        ]


class Incident(models.Model):
    incident_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.CharField(max_length=100)
    transaction_id = models.CharField(max_length=100)
    merchant_id = models.CharField(max_length=100)
    type = models.CharField(max_length=50)
    severity = models.CharField(max_length=10)
    expected_value = models.BigIntegerField(default=0)
    actual_value = models.BigIntegerField(default=0)
    difference = models.BigIntegerField(default=0)
    status = models.CharField(max_length=20, default="OPEN")
    detected_at = models.DateTimeField(auto_now_add=True)
    last_detected_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True)
    assigned_to_reference = models.CharField(max_length=100, blank=True)
    condition_present = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "transaction_id", "type"], name="unique_incident_rule"
            )
        ]
        indexes = [
            models.Index(fields=["organization", "status", "-detected_at"]),
            models.Index(fields=["organization", "transaction_id"]),
        ]


class IncidentActivity(models.Model):
    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="activity")
    actor = models.CharField(max_length=100)
    action = models.CharField(max_length=50)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    metadata = models.JSONField(default=dict)

    class Meta:
        ordering = ["created_at"]
