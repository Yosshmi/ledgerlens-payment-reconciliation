from rest_framework import serializers

from .models import Incident, IncidentActivity


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError("Unknown fields: " + ", ".join(sorted(unknown)))
        return super().to_internal_value(data)


def money():
    return serializers.IntegerField(min_value=0, max_value=1_000_000_000_000)


class SettlementSerializer(StrictSerializer):
    amountMinor = money()
    settlementAmountMinor = money()
    status = serializers.ChoiceField(choices=["COMPLETED", "FAILED", "PENDING"])


class RefundSerializer(StrictSerializer):
    amountMinor = money()
    status = serializers.ChoiceField(choices=["PENDING", "PROCESSING", "SUCCESS", "FAILED"])


class PaymentSerializer(StrictSerializer):
    transactionId = serializers.RegexField(r"^TXN_[A-Z0-9_]+$", max_length=100)
    merchantId = serializers.RegexField(r"^MER_[A-Z0-9_]+$", max_length=100)
    amountMinor = money()
    currency = serializers.ChoiceField(choices=["INR"])
    status = serializers.ChoiceField(
        choices=[
            "CREATED",
            "PENDING",
            "AUTHORIZED",
            "SUCCESS",
            "FAILED",
            "REFUNDED",
            "PARTIALLY_REFUNDED",
        ]
    )
    paymentMethod = serializers.ChoiceField(choices=["CARD", "UPI", "NET_BANKING", "WALLET"])
    createdAt = serializers.DateTimeField()
    sourceUpdatedAt = serializers.DateTimeField()
    settlementDueAt = serializers.DateTimeField()
    ledgerDebitMinor = money()
    merchantCreditMinor = money()
    refundedMinor = money()
    refundLedgerMinor = money()
    settlements = SettlementSerializer(many=True, max_length=1000)
    refunds = RefundSerializer(many=True, max_length=1000)


class BatchSerializer(StrictSerializer):
    payments = PaymentSerializer(many=True, max_length=250, allow_empty=False)


class ActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = IncidentActivity
        fields = ["actor", "action", "note", "created_at", "metadata"]


class IncidentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Incident
        exclude = ["organization"]


class IncidentUpdateSerializer(StrictSerializer):
    status = serializers.ChoiceField(
        choices=["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED"], required=False
    )
    note = serializers.CharField(max_length=2000, required=False)
    assignedToReference = serializers.CharField(max_length=100, required=False, allow_blank=True)
