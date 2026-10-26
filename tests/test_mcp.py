"""Exercise actual MCP initialization/tool calls against the real editor ASGI app."""

import sys
from pathlib import Path

import httpx
import pytest

pytest.importorskip("mcp")

from annotation_studio import main
from atomworks_studio_rfd4 import CONDITION_PROVIDER, VALIDATION_PROVIDER
from cifeditor_mcp.client import EditorClient
from cifeditor_mcp.server import create_server
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.shared.memory import create_connected_server_and_client_session

FIXTURE = Path(__file__).parent / "fixtures" / "minimal_multichain.cif"
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def mcp_session(monkeypatch):
    monkeypatch.setattr(
        main,
        "store",
        main.DocumentStore(
            condition_provider=CONDITION_PROVIDER,
            validation_provider=VALIDATION_PROVIDER,
        ),
    )
    editor = EditorClient("http://editor.test", transport=httpx.ASGITransport(app=main.app))
    try:
        async with create_connected_server_and_client_session(create_server(editor)) as session:
            yield session, editor
    finally:
        await editor.close()


async def call(session, name, **arguments):
    result = await session.call_tool(name, arguments)
    assert not result.isError, result.content
    return result.structuredContent


async def test_mcp_import_preview_edit_conflict_export_and_undo(mcp_session):
    session, editor = mcp_session
    tools = await session.list_tools()
    names = {tool.name for tool in tools.tools}
    assert {"open_structure", "inspect_session", "query_selection", "set_condition", "export_cif", "undo"} <= names
    mutation_schema = next(tool.inputSchema for tool in tools.tools if tool.name == "set_condition")
    assert "expected_revision" in mutation_schema["required"]
    opened = await call(session, "open_structure", filename="shared.cif", content=FIXTURE.read_text())
    sid = opened["session_id"]
    assert f"session={sid}" in opened["editor_url"]
    preview = await call(session, "query_selection", session_id=sid, expression="atom_name == 'CA'")
    assert preview["count"] > 0 and preview["revision"] == 0
    edited = await call(
        session,
        "set_condition",
        session_id=sid,
        condition="hotspot",
        atom_indices=preview["atom_indices"],
        expected_revision=preview["revision"],
    )
    assert edited["structure"]["condition_counts"]["hotspot"] == preview["count"]
    # The browser's API sees precisely the same in-memory document.
    browser = await editor.request("GET", f"sessions/{sid}/snapshot")
    assert browser["structure"]["revision"] == edited["structure"]["revision"]
    stale = await session.call_tool("delete_atoms", {"session_id": sid, "atom_indices": [0], "expected_revision": 0})
    assert stale.isError and "revision_conflict" in stale.content[0].text
    exported = await call(session, "export_cif", session_id=sid)
    assert exported["revision"] == 1 and "data_" in exported["cif"] and isinstance(exported["issues"], list)
    reopened = await call(session, "open_structure", filename="roundtrip.cif", content=exported["cif"])
    assert reopened["structure"]["condition_counts"]["hotspot"] == preview["count"]
    undone = await call(session, "undo", session_id=sid, expected_revision=1)
    assert undone["structure"]["condition_counts"].get("hotspot", 0) == 0
    assert undone["structure"]["revision"] == 2


async def test_pdb_import_and_session_binding(mcp_session):
    session, _ = mcp_session
    pdb = "ATOM      1  CA  GLY A   1       1.450   0.000   0.000  1.00 11.00           C\nEND\n"
    opened = await call(session, "open_structure", filename="gly.pdb", content=pdb)
    bound = await call(session, "inspect_session", session_id=opened["session_id"])
    assert bound["structure"]["atom_count"] == 1
    schema = await call(session, "editor_schema")
    assert "hotspot" in schema["conditions"]


async def test_invalid_ids_and_values_return_mcp_errors(mcp_session):
    session, _ = mcp_session
    invalid = await session.call_tool("inspect_session", {"session_id": "../../api/schema"})
    assert invalid.isError
    missing = await session.call_tool("inspect_session", {"session_id": "x" * 32})
    assert missing.isError and "404" in missing.content[0].text
    opened = await call(session, "open_structure", filename="sample.cif", content=FIXTURE.read_text())
    invalid = await session.call_tool(
        "set_condition",
        {"session_id": opened["session_id"], "condition": "invented", "atom_indices": [0], "expected_revision": 0},
    )
    assert invalid.isError and "422" in invalid.content[0].text
    intact = await call(session, "inspect_session", session_id=opened["session_id"])
    assert intact["structure"]["revision"] == 0


async def test_gui_write_invalidates_agent_preview(mcp_session):
    session, editor = mcp_session
    opened = await call(session, "open_structure", filename="sample.cif", content=FIXTURE.read_text())
    sid = opened["session_id"]
    preview = await call(session, "query_selection", session_id=sid, expression="atom_name == 'CA'")
    await editor.mutate(sid, "charges", 0, {"atom_indices": [0], "value": 2})
    stale = await session.call_tool(
        "set_condition",
        {"session_id": sid, "condition": "hotspot", "atom_indices": preview["atom_indices"], "expected_revision": 0},
    )
    assert stale.isError and "revision_conflict" in stale.content[0].text
    refreshed = await call(session, "inspect_session", session_id=sid)
    assert refreshed["structure"]["revision"] == 1


async def test_stdio_entry_point_initializes_without_polluting_protocol_stdout():
    parameters = StdioServerParameters(command=sys.executable, args=["-m", "cifeditor_mcp.server"])
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write) as session:
            initialized = await session.initialize()
            assert initialized.serverInfo.name == "CIF Editor"
            tools = await session.list_tools()
            assert len(tools.tools) == 13
            result = await session.call_tool("inspect_session", {"session_id": "../not-a-session"})
            assert result.isError
