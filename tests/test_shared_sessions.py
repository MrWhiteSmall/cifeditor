"""GUI and MCP share locked snapshots and conditional edit transactions."""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from annotation_studio import main
from annotation_studio.core import StudioDocument
from atomworks_studio_rfd4 import CONDITION_PROVIDER, VALIDATION_PROVIDER
from fastapi.testclient import TestClient

FIXTURE = Path(__file__).parent / "fixtures" / "minimal_multichain.cif"


@pytest.fixture
def shared(monkeypatch, tmp_path):
    documents = main.DocumentStore(
        tmp_path, condition_provider=CONDITION_PROVIDER, validation_provider=VALIDATION_PROVIDER
    )
    monkeypatch.setattr(main, "store", documents)
    sid = documents.add(
        StudioDocument.from_cif(
            FIXTURE.read_text(),
            "shared",
            condition_provider=CONDITION_PROVIDER,
            validation_provider=VALIDATION_PROVIDER,
        )
    )
    return TestClient(main.app), sid, tmp_path


def test_selection_snapshot_and_revision_agree(shared):
    client, sid, _ = shared
    path = f"/api/v1/sessions/{sid}"
    selected = client.post(path + "/selections/query", json={"expression": "atom_name == 'CA'"}).json()
    assert selected["count"] > 0 and selected["revision"] == 0
    changed = client.post(
        path + "/conditions",
        headers={"If-Match": '"0"'},
        json={
            "condition": "hotspot",
            "atom_indices": selected["atom_indices"],
        },
    )
    assert changed.status_code == 200, changed.text
    snapshot = client.get(path + "/snapshot").json()
    assert snapshot["structure"]["revision"] == client.get(path + "/revision").json()["revision"] == 1
    document = StudioDocument.from_cif(snapshot["cif"], condition_provider=CONDITION_PROVIDER)
    assert document.summary()["condition_counts"]["hotspot"] == selected["count"]


def test_displayed_chain_has_an_unambiguous_query_for_assembly_instance(shared):
    client, _, _ = shared
    example = client.get("/api/v1/examples/protein_binder/cif")
    assert example.status_code == 200
    opened = client.post("/api/v1/sessions", files={"file": ("example.cif", example.text)}).json()
    chain = next(item for item in opened["structure"]["chain_identifiers"] if item["display_id"] == "A_1")
    assert chain["chain_id"] == "A" and "chain_iid" in chain["query"]
    selected = client.post(
        f"/api/v1/sessions/{opened['session_id']}/selections/query",
        json={
            "expression": f'({chain["query"]}) and res_id >= 17 and res_id <= 20 and atom_name == "CA"',
        },
    ).json()
    assert selected["count"] == 4


def test_simultaneous_edits_at_same_revision_only_commit_once(shared):
    client, sid, _ = shared
    path = f"/api/v1/sessions/{sid}/charges"

    def change(value):
        return client.post(path, headers={"If-Match": '"0"'}, json={"atom_indices": [0], "value": value})

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(change, [1, 2]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    conflict = next(response.json() for response in responses if response.status_code == 409)
    assert conflict["detail"]["code"] == "revision_conflict"
    assert client.get(f"/api/v1/sessions/{sid}").json()["structure"]["undo_depth"] == 1


def test_stale_undo_and_structural_delete_are_rejected_without_changing_document(shared):
    client, sid, _ = shared
    path = f"/api/v1/sessions/{sid}"
    assert client.post(path + "/charges", json={"atom_indices": [0], "value": 1}).status_code == 200
    before = client.get(path + "/snapshot").json()
    for operation, body in [("delete", {"atom_indices": [0]}), ("undo", None)]:
        response = client.post(path + "/" + operation, headers={"If-Match": '"0"'}, json=body)
        assert response.status_code == 409, response.text
    after = client.get(path + "/snapshot").json()
    assert after["structure"] == before["structure"]
    assert client.post(path + "/undo", headers={"If-Match": '"1"'}).status_code == 200


@pytest.mark.parametrize("header", ["*", "0", 'W/"0"', '"-1"', '"bad"'])
def test_invalid_if_match_never_edits(shared, header):
    client, sid, _ = shared
    response = client.post(
        f"/api/v1/sessions/{sid}/charges",
        headers={"If-Match": header},
        json={
            "atom_indices": [0],
            "value": 1,
        },
    )
    assert response.status_code == 400
    assert client.get(f"/api/v1/sessions/{sid}/revision").json()["revision"] == 0


def test_revision_and_undo_survive_store_restart(shared, monkeypatch):
    client, sid, directory = shared
    path = f"/api/v1/sessions/{sid}"
    assert client.post(path + "/conditions", json={"condition": "hotspot", "atom_indices": [0]}).status_code == 200
    monkeypatch.setattr(
        main,
        "store",
        main.DocumentStore(
            directory,
            condition_provider=CONDITION_PROVIDER,
            validation_provider=VALIDATION_PROVIDER,
        ),
    )
    restored = client.get(path).json()["structure"]
    assert restored["revision"] == 1 and restored["undo_depth"] == 1
    assert client.post(path + "/undo", headers={"If-Match": '"0"'}).status_code == 409
    undone = client.post(path + "/undo", headers={"If-Match": '"1"'}).json()["structure"]
    assert undone["revision"] == 2 and undone["condition_counts"].get("hotspot", 0) == 0


def test_legacy_cif_snapshot_remains_readable(shared, monkeypatch):
    client, sid, directory = shared
    cif = client.get(f"/api/v1/sessions/{sid}/cif").text
    (directory / f"{sid}.session").write_text(json.dumps({"name": "legacy", "owner_id": "local"}) + "\n" + cif)
    monkeypatch.setattr(main, "store", main.DocumentStore(directory))
    restored = client.get(f"/api/v1/sessions/{sid}").json()["structure"]
    assert restored["name"] == "legacy" and restored["atom_count"] > 0 and restored["revision"] == 0
