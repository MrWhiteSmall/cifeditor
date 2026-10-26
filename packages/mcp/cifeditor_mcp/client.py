"""Reuse the editor's versioned API, validation, ownership and edit transactions."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from urllib.parse import urlencode, urlsplit

import httpx
from mcp.server.fastmcp.exceptions import ToolError


class EditorClient:
    def __init__(
        self, url: str, *, token: str | None = None, transport: httpx.AsyncBaseTransport | None = None,
        headers: Mapping[str, str] | None = None,
    ):
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("CIFEDITOR_URL must be the trusted editor's HTTP(S) base URL")
        self.url = url.rstrip("/")
        self.http = httpx.AsyncClient(
            base_url=self.url + "/api/v1/",
            headers={**(headers or {}), **({"Authorization": f"Bearer {token}"} if token else {})},
            timeout=150,
            trust_env=False,
            follow_redirects=False,
            transport=transport,
        )

    async def close(self) -> None:
        await self.http.aclose()

    @staticmethod
    def session_path(session_id: str, suffix: str = "") -> str:
        if re.fullmatch(r"[A-Za-z0-9_-]{20,64}", session_id) is None:
            raise ToolError("Use the exact session_id returned by open_structure or copied from the editor.")
        return f"sessions/{session_id}{suffix}"

    async def request(self, method: str, path: str, *, revision: int | None = None, **kwargs) -> dict:
        headers = {"If-Match": f'"{revision}"'} if revision is not None else {}
        try:
            response = await self.http.request(method, path, headers=headers, **kwargs)
        except httpx.TransportError as error:
            raise ToolError(
                "Editor connection failed. Check CIFEDITOR_URL and that the editor is running. "
                "Do not retry edits blindly; inspect the session to see whether the edit committed."
            ) from error
        if not response.is_success:
            try:
                detail = response.json().get("detail", response.reason_phrase)
            except ValueError:
                detail = response.reason_phrase
            raise ToolError(json.dumps({"status": response.status_code, "detail": detail}, ensure_ascii=False))
        result = response.json()
        if isinstance(result, dict) and "session_id" in result:
            result["editor_url"] = self.url + "/?" + urlencode({"session": result["session_id"], "lang": "zh-CN"})
        return result

    async def mutate(self, session_id: str, operation: str, revision: int, body: dict | None = None) -> dict:
        return await self.request("POST", self.session_path(session_id, f"/{operation}"), revision=revision, json=body)
