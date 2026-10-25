"""Normalize supported structure uploads before using the shared CIF editor."""

from io import StringIO
from pathlib import Path

from atomworks.io import load_pdb
from atomworks.io.utils.io_utils import to_cif_string
from biotite.structure import AtomArrayStack

SUPPORTED_STRUCTURE_SUFFIXES = {".cif", ".mmcif", ".pdb", ".ent"}


def structure_to_cif(text: str, filename: str) -> str:
    """Keep CIFs untouched; convert PDB models with AtomWorks' native loader.

    Conversion does not complete missing atoms or add design conditions. The
    ordinary import presets are applied afterwards, exactly as for a CIF upload.
    """
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_STRUCTURE_SUFFIXES:
        raise ValueError("Only PDB, ENT, CIF and mmCIF files are supported")
    if suffix in {".cif", ".mmcif"}:
        return text
    atoms, _metadata = load_pdb(StringIO(text), model=None)
    if atoms.array_length() == 0:
        raise ValueError("The PDB file contains no atoms")
    models = list(atoms) if isinstance(atoms, AtomArrayStack) else [atoms]
    return to_cif_string(models)
