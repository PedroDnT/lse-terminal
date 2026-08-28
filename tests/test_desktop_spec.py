"""The frozen desktop build must ship what the plugin system needs.

Plugins are found at runtime through entry points, which static analysis
cannot see, so the PyInstaller spec has to be told about them explicitly.
Getting that wrong fails in the worst possible way: the module still
imports, the entry-point group is simply empty, `load_plugins` records no
error, and the desktop app quietly lacks those sources with nothing
anywhere saying so.

These tests tie the spec to the registry rather than to a list of names,
so adding a fourth entry-point group to `load_plugins` fails here until
the spec knows about it too.
"""

from __future__ import annotations

import re
from pathlib import Path

SPEC = Path(__file__).parent.parent / "desktop" / "pyi-spec" / "lset-server.spec"
REGISTRY = Path(__file__).parent.parent / "lse_terminal" / "engine" / "registry.py"


def entry_point_groups(source: str) -> set[str]:
    return set(re.findall(r'entry_points\(group="([^"]+)"\)', source))


def code_only(source: str) -> str:
    """The spec with comment lines stripped.

    The first version of these tests searched the raw file and passed
    against the word `copy_metadata` sitting in a comment explaining why
    copy_metadata matters -- while the actual call had been deleted. A
    test that a comment can satisfy is not a test.
    """
    return "\n".join(line for line in source.splitlines()
                      if not line.lstrip().startswith("#"))


def test_the_spec_covers_every_group_the_registry_walks():
    walked = entry_point_groups(REGISTRY.read_text())
    assert walked, "registry.load_plugins should walk at least one group"
    spec = code_only(SPEC.read_text())
    declared = set(re.findall(r'"(lse_terminal\.[a-z]+)"', spec))
    missing = walked - declared
    assert not missing, (
        f"the desktop spec does not know about {sorted(missing)}; plugins in "
        f"those groups would vanish from the frozen build without any error")


def test_the_spec_ships_plugin_metadata():
    """copy_metadata is the half everyone forgets.

    Collecting the modules is not enough: entry_points() reads a
    distribution's .dist-info, and PyInstaller drops it by default. With
    the module importable but its dist-info absent, the registry finds no
    providers and reports plugin_errors == [].
    """
    spec = code_only(SPEC.read_text())
    assert "from PyInstaller.utils.hooks import copy_metadata" in spec, \
        "copy_metadata is not even imported"
    assert re.search(r"datas \+= copy_metadata\(", spec), \
        "plugin dist-info would not ship: entry_points() reads it, and " \
        "without it the registry silently finds no providers"
    assert re.search(r"hiddenimports \+= collect_submodules\(_name\)", spec), \
        "plugin modules would not be baked into the PYZ"
