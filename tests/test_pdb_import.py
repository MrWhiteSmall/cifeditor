"""PDB conversion preserves model coordinates and feeds the existing CIF editor."""

from io import StringIO
from pathlib import Path

import numpy as np
import pytest
from annotation_studio.importing import structure_to_cif
from annotation_studio.main import app
from biotite.structure.io.pdb import PDBFile
from biotite.structure.io.pdbx import CIFFile, get_structure
from fastapi.testclient import TestClient

PDB = """ATOM      1  N   GLY A   1       0.000   0.000   0.000  1.00 10.00           N
ATOM      2  CA  GLY A   1       1.450   0.000   0.000  1.00 11.00           C
ATOM      3  C   GLY A   1       2.100   1.300   0.000  1.00 12.00           C
ATOM      4  O   GLY A   1       1.600   2.400   0.000  1.00 13.00           O
END
"""
client = TestClient(app)


def test_pdb_conversion_preserves_identity_and_coordinates():
    before = PDBFile.read(StringIO(PDB)).get_structure(model=1)
    after = get_structure(CIFFile.read(StringIO(structure_to_cif(PDB, "input.PDB"))), model=1)
    assert list(after.atom_name) == list(before.atom_name)
    assert list(after.res_name) == list(before.res_name)
    assert list(after.chain_id) == list(before.chain_id)
    np.testing.assert_allclose(after.coord, before.coord, atol=1e-4)


def test_multiple_models_are_not_silently_discarded():
    model = PDB.removesuffix("END\n")
    text = f"MODEL        1\n{model}ENDMDL\nMODEL        2\n{model}ENDMDL\nEND\n"
    atoms = get_structure(CIFFile.read(StringIO(structure_to_cif(text, "ensemble.ent"))))
    assert atoms.stack_depth() == 2
    assert atoms.array_length() == 4


def test_cif_is_passed_through_without_rewriting_custom_categories():
    text = (Path(__file__).parent / "fixtures/custom_category.cif").read_text()
    assert structure_to_cif(text, "annotated.mmcif") == text


def test_pdb_api_conversion_edit_export_reimport_and_undo():
    files = {"file": ("gly.pdb", PDB, "chemical/x-pdb")}
    converted = client.post("/api/v1/import/convert", files=files)
    assert converted.status_code == 200, converted.text
    assert converted.json()["name"] == "gly.cif"
    assert "_atom_site." in converted.json()["cif"]
    inspection = client.post("/api/v1/import/inspect", files=files)
    assert inspection.status_code == 200, inspection.text
    created = client.post("/api/v1/sessions", files=files)
    assert created.status_code == 200, created.text
    payload = created.json()
    session = payload["session_id"]
    assert payload["structure"]["atom_count"] == 4
    edited = client.post(
        f"/api/v1/sessions/{session}/conditions", json={"condition": "hotspot", "atom_indices": [0], "enabled": True}
    )
    assert edited.status_code == 200, edited.text
    exported = client.get(f"/api/v1/sessions/{session}/cif")
    assert exported.status_code == 200
    reopened = client.post("/api/v1/sessions", files={"file": ("saved.cif", exported.content)})
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["structure"]["condition_counts"]["hotspot"] == 1
    undone = client.post(f"/api/v1/sessions/{session}/undo")
    assert undone.status_code == 200, undone.text
    assert undone.json()["structure"]["condition_counts"].get("hotspot", 0) == 0


@pytest.mark.parametrize(
    ("filename", "content", "status"),
    [("bad.pdb", "not a structure", 422), ("empty.pdb", "", 422), ("data.txt", PDB, 415), ("bad.pdb", b"\xff", 422)],
)
def test_invalid_uploads_are_rejected(filename, content, status):
    response = client.post("/api/v1/import/convert", files={"file": (filename, content)})
    assert response.status_code == status, response.text
