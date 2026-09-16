import hmac
import re
from types import SimpleNamespace

from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


class InternalAuthentication(BaseAuthentication):
    def authenticate(self, request):
        authorization = request.headers.get("Authorization", "")
        expected = "Bearer " + settings.INTERNAL_SERVICE_SECRET
        if not hmac.compare_digest(authorization, expected):
            raise AuthenticationFailed("Invalid service credentials")
        organization = request.headers.get("X-Organization", "")
        if not re.fullmatch(r"ORG_[A-Z0-9_]{1,90}", organization):
            raise AuthenticationFailed("Invalid organization context")
        request.organization = organization
        request.actor = request.headers.get("X-Actor", "SYSTEM")[:100]
        request.role = request.headers.get("X-Role", "")
        return SimpleNamespace(is_authenticated=True), None

    def authenticate_header(self, request):
        return "Bearer"
