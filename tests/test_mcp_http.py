"""Official Streamable HTTP protocol reaches the same editor with request identity intact."""

from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest

pytest.importorskip("mcp")

from annotation_studio import main
from atomworks_studio_rfd4 import CONDITION_PROVIDER, VALIDATION_PROVIDER
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

FIXTURE = Path(__file__).parent / "fixtures" / "minimal_multichain.cif"
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def http_editor(monkeypatch):
    monkeypatch.setattr(main, "store", main.DocumentStore(
        condition_provider=CONDITION_PROVIDER, validation_provider=VALIDATION_PROVIDER,
    ))
    async with main.app.router.lifespan_context(main.app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://localhost") as api:
            yield api


@asynccontextmanager
async def connected(owner: str | None = None):
    headers = {"X-User": owner} if owner else {}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), headers=headers) as client:
        async with streamable_http_client("http://localhost/mcp", http_client=client) as (read, write, session_id):
            async with ClientSession(read, write) as session:
                initialized = await session.initialize()
                assert initialized.serverInfo.name == "CIF Editor"
                assert session_id() is None  # Document IDs are explicit; no cross-user transport session.
                yield session


async def invoke(session, name, **arguments):
    result = await session.call_tool(name, arguments)
    assert not result.isError, result.content
    return result.structuredContent


async def test_http_initialize_discover_edit_export_and_gui_share_revision(http_editor):
    async with connected() as session:
        tools = await session.list_tools()
        assert len(tools.tools) == 13
        opened = await invoke(session, "open_structure", filename="http.cif", content=FIXTURE.read_text())
        sid = opened["session_id"]
        assert opened["editor_url"].startswith("http://localhost/?session=")
        selected = await invoke(session, "query_selection", session_id=sid, expression="atom_name == 'CA'")
        changed = await invoke(session, "set_condition", session_id=sid, condition="hotspot",
                               atom_indices=selected["atom_indices"], expected_revision=selected["revision"])
        assert changed["structure"]["revision"] == 1
        gui = (await http_editor.get(f"/api/v1/sessions/{sid}/snapshot")).json()
        assert gui["structure"]["condition_counts"]["hotspot"] == selected["count"]
        exported = await invoke(session, "export_cif", session_id=sid)
        assert exported["revision"] == 1 and "data_" in exported["cif"]
        stale = await session.call_tool(
            "delete_atoms", {"session_id": sid, "atom_indices": [0], "expected_revision": 0},
        )
        assert stale.isError and "revision_conflict" in stale.content[0].text
        undone = await invoke(session, "undo", session_id=sid, expected_revision=1)
        assert undone["structure"]["revision"] == 2


async def test_http_request_identity_never_crosses_users(http_editor, monkeypatch):
    monkeypatch.setattr(main, "IDENTITY_HEADER", "X-User")
    response = await http_editor.post("/mcp", json={})
    assert response.status_code == 401
    async with connected("alice") as alice, connected("bob") as bob:
        opened = await invoke(alice, "open_structure", filename="alice.cif", content=FIXTURE.read_text())
        sid = opened["session_id"]
        denied = await bob.call_tool("inspect_session", {"session_id": sid})
        assert denied.isError and "404" in denied.content[0].text
        denied = await bob.call_tool("set_charge", {
            "session_id": sid, "atom_indices": [0], "expected_revision": 0, "value": 2,
        })
        assert denied.isError and "404" in denied.content[0].text
        assert (await invoke(alice, "inspect_session", session_id=sid))["structure"]["revision"] == 0
        assert (await http_editor.get(f"/api/v1/sessions/{sid}", headers={"X-User": "alice"})).status_code == 200
        assert (await http_editor.get(f"/api/v1/sessions/{sid}", headers={"X-User": "bob"})).status_code == 404
        own = (await http_editor.get("/api/v1/sessions", headers={"X-User": "alice"})).json()["sessions"]
        assert [item["session_id"] for item in own] == [sid]


async def test_protocol_route_is_not_html_and_rejects_untrusted_host_origin_and_oversize(http_editor):
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    message = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"},
    }}
    response = await http_editor.post("/mcp", headers=headers, json=message)
    assert response.status_code == 200 and response.headers["content-type"].startswith("application/json")
    assert response.headers["cache-control"] == "no-store"
    bad_host = await http_editor.post("/mcp", headers={**headers, "Host": "attacker.test"}, json=message)
    assert bad_host.status_code == 421
    bad_origin = await http_editor.post("/mcp", headers={**headers, "Origin": "https://attacker.test"}, json=message)
    assert bad_origin.status_code == 403
    too_large = await http_editor.post(
        "/mcp", headers={**headers, "Content-Length": str(41 * 1024 * 1024)}, content="{}",
    )
    assert too_large.status_code == 413
    browser = await http_editor.get("/mcp")
    assert browser.status_code in {405, 406} and "text/html" not in browser.headers.get("content-type", "")
