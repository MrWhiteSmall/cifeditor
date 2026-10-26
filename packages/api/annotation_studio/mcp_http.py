"""Mount the official HTTP transport and bind each tool to its authenticated request."""

from __future__ import annotations

import os
from collections.abc import Callable

import httpx
from cifeditor_mcp.client import EditorClient
from cifeditor_mcp.server import create_server
from fastapi import FastAPI
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.types import Receive, Scope, Send


class HTTPMCPEndpoint:
    """Delegate to the SDK app belonging to the current FastAPI lifespan."""

    def __init__(self, app: FastAPI):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self.app.state.mcp_http(scope, receive, send)


class RequestEditorClient(EditorClient):
    """A tool-scoped binding; each API call owns and closes its HTTPX client."""

    def __init__(self, request: Request, app: FastAPI, identity_header: str | None):
        self.url = str(request.base_url).rstrip("/")
        self._app = app
        # Forward only the identity already checked by the trusted-proxy middleware.
        self._headers = {identity_header: request.headers[identity_header]} if identity_header else {}

    async def request(self, method: str, path: str, *, revision: int | None = None, **kwargs) -> dict:
        editor = EditorClient(self.url, transport=httpx.ASGITransport(app=self._app), headers=self._headers)
        try:
            return await editor.request(method, path, revision=revision, **kwargs)
        finally:
            await editor.close()


def create_http_application(app: FastAPI, identity_header: Callable[[], str | None]) -> tuple[FastMCP, Starlette]:
    hosts = ["localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*", "[::1]", "[::1]:*"]
    hosts += [host.strip() for host in os.environ.get("CIFEDITOR_MCP_ALLOWED_HOSTS", "").split(",") if host.strip()]
    security = TransportSecuritySettings(
        allowed_hosts=hosts,
        allowed_origins=[f"{scheme}://{host}" for scheme in ("http", "https") for host in hosts],
    )

    def client_for_request(ctx: Context) -> EditorClient:
        request = ctx.request_context.request
        if not isinstance(request, Request):
            raise RuntimeError("HTTP request context is required")
        return RequestEditorClient(request, app, identity_header())

    server = create_server(client_factory=client_for_request, transport_security=security)
    return server, server.streamable_http_app()
