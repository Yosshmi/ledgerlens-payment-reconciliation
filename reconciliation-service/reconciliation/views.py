from django.db import connection, transaction
from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import TruncDate
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from .models import Incident, IncidentActivity, PaymentProjection
from .serializers import (
    ActivitySerializer,
    BatchSerializer,
    IncidentSerializer,
    IncidentUpdateSerializer,
)
from .services import reconcile_batch


def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return JsonResponse({"status": "ready"})
    except Exception:
        return JsonResponse({"status": "unavailable"}, status=503)


@api_view(["POST"])
def reconcile(request):
    if request.role != "SYSTEM":
        raise PermissionDenied("Only the worker can submit projections")
    serializer = BatchSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    findings = reconcile_batch(request.organization, serializer.validated_data["payments"])
    return Response({"processed": len(serializer.validated_data["payments"]), "findings": findings})


@api_view(["GET"])
def incidents(request):
    queryset = Incident.objects.filter(organization=request.organization)
    for field in ["status", "severity"]:
        if request.query_params.get(field):
            queryset = queryset.filter(**{field: request.query_params[field]})
    if request.query_params.get("transactionId"):
        queryset = queryset.filter(transaction_id=request.query_params["transactionId"])
    search = request.query_params.get("search", "")[:100]
    if search:
        queryset = queryset.filter(
            Q(transaction_id__icontains=search)
            | Q(type__icontains=search)
            | Q(merchant_id__icontains=search)
        )
    try:
        page = int(request.query_params.get("page", 1))
        limit = int(request.query_params.get("limit", 25))
    except ValueError:
        raise ValidationError("Invalid pagination")
    if not 1 <= page <= 10000 or not 1 <= limit <= 100:
        raise ValidationError("Invalid pagination")
    total = queryset.count()
    items = queryset.order_by("-detected_at", "incident_id")[(page - 1) * limit : page * limit]
    return Response(
        {
            "items": IncidentSerializer(items, many=True).data,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": (total + limit - 1) // limit,
        }
    )


@api_view(["GET", "PATCH"])
def incident_detail(request, incident_id):
    if request.method == "GET":
        incident = get_object_or_404(
            Incident, organization=request.organization, incident_id=incident_id
        )
    else:
        if request.role not in {"ADMIN", "OPERATIONS", "FINANCE"}:
            raise PermissionDenied("Role cannot manage incidents")
        serializer = IncidentUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not data:
            raise ValidationError("An update is required")
        if data.get("status") == "IGNORED" and request.role not in {"ADMIN", "FINANCE"}:
            raise PermissionDenied("Only finance or administrators may ignore incidents")
        if data.get("status") in {"RESOLVED", "IGNORED"} and not data.get("note"):
            raise ValidationError("A resolution note is required")
        with transaction.atomic():
            incident = get_object_or_404(
                Incident.objects.select_for_update(),
                organization=request.organization,
                incident_id=incident_id,
            )
            before = {
                "status": incident.status,
                "assignedToReference": incident.assigned_to_reference,
            }
            if "status" in data:
                allowed = {
                    "OPEN": {"INVESTIGATING", "RESOLVED", "IGNORED"},
                    "INVESTIGATING": {"OPEN", "RESOLVED", "IGNORED"},
                    "RESOLVED": {"OPEN"},
                    "IGNORED": {"OPEN"},
                }
                if (
                    data["status"] != incident.status
                    and data["status"] not in allowed[incident.status]
                ):
                    raise ValidationError("Invalid incident transition")
                incident.status = data["status"]
                incident.resolved_at = (
                    timezone.now() if incident.status in {"RESOLVED", "IGNORED"} else None
                )
            if "assignedToReference" in data:
                incident.assigned_to_reference = data["assignedToReference"]
            incident.save()
            IncidentActivity.objects.create(
                incident=incident,
                actor=request.actor,
                action="UPDATED",
                note=data.get("note", ""),
                metadata={
                    "before": before,
                    "after": {
                        "status": incident.status,
                        "assignedToReference": incident.assigned_to_reference,
                    },
                },
            )
    return Response(
        {
            **IncidentSerializer(incident).data,
            "activity": ActivitySerializer(incident.activity.all()[:200], many=True).data,
        }
    )


def overview(organization, merchant_id=None):
    payments = PaymentProjection.objects.filter(organization=organization)
    issues = Incident.objects.filter(organization=organization)
    if merchant_id:
        payments = payments.filter(merchant_id=merchant_id)
        issues = issues.filter(merchant_id=merchant_id)
    totals = payments.aggregate(
        transactions=Count("id"),
        volumeMinor=Sum("amount_minor"),
        refundedMinor=Sum("refunded_minor"),
        success=Count("id", filter=Q(status__in=["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"])),
        failed=Count("id", filter=Q(status="FAILED")),
        settled=Count("id", filter=Q(settlement_completed=True)),
        refundCount=Sum("refund_count"),
        failedRefundCount=Sum("failed_refund_count"),
        lastReconciledAt=Max("reconciled_at"),
    )
    for key in ["volumeMinor", "refundedMinor", "refundCount", "failedRefundCount"]:
        totals[key] = totals[key] or 0
    count = totals["transactions"]
    totals["successRate"] = round(totals["success"] / count * 100, 2) if count else 0
    totals["openIncidents"] = issues.filter(status__in=["OPEN", "INVESTIGATING"]).count()
    totals["criticalIncidents"] = issues.filter(
        status__in=["OPEN", "INVESTIGATING"], severity="CRITICAL"
    ).count()
    totals["resolvedIncidents"] = issues.filter(status="RESOLVED").count()
    affected = issues.filter(condition_present=True).values("transaction_id").distinct().count()
    totals["mismatchRate"] = round(affected / count * 100, 2) if count else 0
    totals["settlementRate"] = (
        round(totals["settled"] / totals["success"] * 100, 2) if totals["success"] else 0
    )
    totals["refundRate"] = (
        round(payments.filter(refunded_minor__gt=0).count() / count * 100, 2) if count else 0
    )
    daily = list(
        payments.annotate(date=TruncDate("created_at"))
        .values("date")
        .annotate(
            count=Count("id"),
            volumeMinor=Sum("amount_minor"),
            failed=Count("id", filter=Q(status="FAILED")),
        )
        .order_by("-date")[:30]
    )
    return {
        **totals,
        "daily": list(reversed(daily)),
        "methods": list(
            payments.values("payment_method").annotate(count=Count("id")).order_by("-count")
        ),
        "merchants": list(
            payments.values("merchant_id")
            .annotate(count=Count("id"), volumeMinor=Sum("amount_minor"))
            .order_by("-volumeMinor")[:20]
        ),
        "incidentTypes": list(
            issues.filter(condition_present=True)
            .values("type")
            .annotate(count=Count("incident_id"))
            .order_by("-count")
        ),
    }


@api_view(["GET"])
def analytics(request, report):
    if report not in {
        "overview",
        "reconciliation",
        "payment-health",
        "refund-health",
        "settlement-health",
    }:
        raise ValidationError("Unknown report")
    return Response(overview(request.organization))


@api_view(["GET"])
def merchant_analytics(request, merchant_id):
    return Response(overview(request.organization, merchant_id))
