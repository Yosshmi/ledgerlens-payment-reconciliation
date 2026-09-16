from rest_framework.views import exception_handler


def handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        response.data = {
            "success": False,
            "error": {"code": "REQUEST_REJECTED", "details": response.data},
        }
    return response
