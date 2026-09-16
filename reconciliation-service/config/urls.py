from django.urls import path

from reconciliation import views

urlpatterns = [
    path("health/", views.health),
    path("api/reconcile/", views.reconcile),
    path("api/incidents/", views.incidents),
    path("api/incidents/<uuid:incident_id>/", views.incident_detail),
    path("api/analytics/merchant/<str:merchant_id>/", views.merchant_analytics),
    path("api/analytics/<str:report>/", views.analytics),
]
