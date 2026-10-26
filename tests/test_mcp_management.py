"""Management reads actual tools and owned metadata without extending expiry."""

import builtins
import os
import time
from pathlib import Path

import pytest
from annotation_studio import main
from annotation_studio.core import StudioDocument
from annotation_studio.identity import reset_current_owner, set_current_owner
from fastapi.testclient import TestClient

FIXTURE = Path(__file__).parent / "fixtures" / "minimal_multichain.cif"


@pytest.fixture
def management(monkeypatch, tmp_path):
    store = main.DocumentStore(tmp_path)
    monkeypatch.setattr(main, "store", store)
    sid = store.add(StudioDocument.from_cif(FIXTURE.read_text(), "owned"))
    return TestClient(main.app), store, sid, tmp_path


def test_catalog_matches_official_sdk(management):
    import anyio
    from cifeditor_mcp.server import create_server

    client, _, _, _ = management
    response = client.get("/api/v1/mcp")
    assert response.status_code == 200
    catalog = response.json()
    assert catalog["available"] and catalog["transport"] == "stdio"
    expected = anyio.run(create_server().list_tools)
    assert catalog["tools"] == [tool.model_dump(mode="json", exclude_none=True) for tool in expected]
    assert next(tool for tool in catalog["tools"] if tool["name"] == "set_charge")["inputSchema"]["required"]
    assert response.headers["cache-control"] == "no-store"


def test_missing_optional_sdk_does_not_break_management(management, monkeypatch):
    client, _, _, _ = management
    original = builtins.__import__

    def without_adapter(name, *args, **kwargs):
        if name == "cifeditor_mcp.server":
            raise ModuleNotFoundError("No module named mcp", name="mcp")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without_adapter)
    response = client.get("/api/v1/mcp")
    assert response.status_code == 200
    assert response.json() == {"available": False, "transport": "stdio", "tools": [], "install_extra": "mcp"}


def test_listing_survives_restart_without_loading_or_touching_documents(management, monkeypatch):
    client, store, sid, directory = management
    store.call(sid, lambda document: document.set_charge([0], value=1), persist=True)
    path = directory / f"{sid}.session"
    before = time.time() - 30
    os.utime(path, (before, before))
    restored = main.DocumentStore(directory)
    monkeypatch.setattr(main, "store", restored)
    response = client.get("/api/v1/sessions")
    assert response.status_code == 200
    session = response.json()["sessions"][0]
    assert session == {"session_id": sid, "name": "owned", "revision": 1, "last_accessed": before}
    assert path.stat().st_mtime == before
    assert not restored._documents


def test_lists_only_current_owner_and_respects_identity_middleware(management, monkeypatch):
    client, store, sid, directory = management
    token = set_current_owner("alice")
    try:
        alice_sid = store.add(StudioDocument.from_cif(FIXTURE.read_text(), "alice-private"))
    finally:
        reset_current_owner(token)
    monkeypatch.setattr(main, "IDENTITY_HEADER", "X-User")
    assert client.get("/api/v1/sessions").status_code == 401
    alice = client.get("/api/v1/sessions", headers={"X-User": "alice"}).json()["sessions"]
    assert [row["session_id"] for row in alice] == [alice_sid]
    monkeypatch.setattr(main, "store", main.DocumentStore(directory))
    local = client.get("/api/v1/sessions", headers={"X-User": "local"}).json()["sessions"]
    assert [row["session_id"] for row in local] == [sid]


def test_listing_does_not_keep_expired_sessions_alive(management):
    client, _, sid, directory = management
    path = directory / f"{sid}.session"
    stale = time.time() - main.SESSION_TTL_SECONDS - 1
    os.utime(path, (stale, stale))
    assert client.get("/api/v1/sessions").json()["sessions"] == []
    assert client.get(f"/api/v1/sessions/{sid}").status_code == 404
