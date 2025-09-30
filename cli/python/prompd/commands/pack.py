"""Alias command `prompd pack` for package creation."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import click

from prompd.commands.common import console
from prompd.commands.package import package_create


@click.command(name="pack")
@click.argument("source", type=click.Path(exists=True, path_type=Path))
@click.argument("output_path", type=click.Path(path_type=Path), required=False)
@click.option("-n", "--name", help="Package name (overrides manifest.json)")
@click.option("-V", "--version", help="Package version (overrides manifest.json)")
@click.option("-d", "--description", help="Package description (overrides manifest.json)")
@click.option("-a", "--author", help="Package author (overrides manifest.json)")
def pack_alias(
    source: Path,
    output_path: Optional[Path],
    name: Optional[str],
    version: Optional[str],
    description: Optional[str],
    author: Optional[str],
):
    """Create a .pdpkg package from a directory (alias for `package create`)."""
    try:
        package_create.callback(source, output_path, name, version, description, author)  # type: ignore[attr-defined]
    except SystemExit:
        raise
    except Exception as exc:
        console.print(f"[red]Package creation failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["pack_alias"]
