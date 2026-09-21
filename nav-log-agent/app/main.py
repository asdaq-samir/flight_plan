import os

from starlette.responses import PlainTextResponse

from . import mcp_server
from .mcp_server import mcp

# This server has no OAuth authorization server of its own to issue scoped
# tokens against -- mcp.server.auth.settings.AuthSettings wants a real
# issuer_url/resource_server_url, infrastructure this single self-hosted
# deployment doesn't have. A flat shared secret is the appropriately-sized
# fix instead: the ALB routes /mcp/* straight to this container with no
# auth of its own in front of it (unlike planning-service, which is never
# given an ALB rule at all), so without this, anyone who finds the URL can
# run real, billed Claude calls and write to the pgvector briefing store.
# Read when the server starts (below), not when the module is imported:
# pdoc imports this module to document it, with no secret to hand.
API_KEY_ENV = "NAV_LOG_AGENT_API_KEY"


class BearerAuthMiddleware:
    """Raw ASGI middleware, not Starlette's BaseHTTPMiddleware -- that
    buffers the whole response before forwarding it, which would break
    the SSE stream this server's transport depends on. This only inspects
    the request header before handing off, so the response passes through
    unbuffered.
    """

    def __init__(self, app, api_key: str):
        self.app = app
        self.expected = f"Bearer {api_key}".encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        if headers.get(b"authorization") != self.expected:
            response = PlainTextResponse("Unauthorized", status_code=401)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


if __name__ == "__main__":
    import uvicorn

    api_key = os.environ.get(API_KEY_ENV)
    if not api_key:
        raise SystemExit(f"{API_KEY_ENV} is not set: the MCP server refuses to start unauthenticated")
    mcp_server.startup()

    # host="0.0.0.0" is required, not cosmetic -- the library's own default
    # (127.0.0.1) is only reachable from inside the container's own network
    # namespace, which breaks both the local Docker port mapping (8082:8000)
    # and reachability from the ALB once this runs on ECS Fargate. sse_path/
    # message_path are set explicitly so they're a known, stable contract
    # (/mcp/sse, /mcp/messages/) that infra/cloudformation/template.yaml's
    # ALB path-based route (/mcp/*) can target, rather than depending on the
    # library's own unprefixed defaults (/sse, /messages/).
    starlette_app = mcp.sse_app(sse_path="/mcp/sse", message_path="/mcp/messages/", host="0.0.0.0")
    uvicorn.run(BearerAuthMiddleware(starlette_app, api_key), host="0.0.0.0", port=8000)
