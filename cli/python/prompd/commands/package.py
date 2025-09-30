"""Package management commands for Prompd."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import click

from prompd.commands.common import console


@click.group(name="package")
def package():
    """Package management commands."""
    pass


@package.command("create")
@click.argument("source", type=click.Path(exists=True, path_type=Path))
@click.argument("output_path", type=click.Path(path_type=Path), required=False)
@click.option("-n", "--name", help="Package name (overrides manifest.json)")
@click.option("-V", "--version", help="Package version (overrides manifest.json)")
@click.option("-d", "--description", help="Package description (overrides manifest.json)")
@click.option("-a", "--author", help="Package author (overrides manifest.json)")
def package_create(
    source: Path,
    output_path: Optional[Path],
    name: Optional[str],
    version: Optional[str],
    description: Optional[str],
    author: Optional[str],
):
    """Create a .pdpkg package from a directory."""
    try:
        from prompd.registry import create_pdpkg, validate_pdpkg

        if not source.is_dir():
            console.print("[red]ERROR[/red] Source must be a directory")
            raise SystemExit(1)

        source_dir = source
        manifest_path = source_dir / "manifest.json"
        manifest_data = {}

        if manifest_path.exists():
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest_data = json.load(f)
                console.print("[dim]Found existing manifest.json[/dim]")
            except (json.JSONDecodeError, Exception) as exc:
                console.print(f"[yellow]Warning: Could not read manifest.json: {exc}[/yellow]")
                manifest_data = {}

        proj_name = name or manifest_data.get("name", source_dir.name.lower().replace(" ", "-").replace("_", "-"))
        proj_version = version or manifest_data.get("version", "1.0.0")
        proj_description = description or manifest_data.get(
            "description", f"Package created from {source_dir.name}"
        )
        proj_author = author or manifest_data.get("author", "unknown")

        if not output_path:
            output_path = source_dir / f"{proj_name}-{proj_version}.pdpkg"

        if not output_path.suffix or output_path.suffix != ".pdpkg":
            output_path = output_path.with_suffix(".pdpkg")

        manifest = {
            "name": proj_name,
            "version": proj_version,
            "description": proj_description,
            "license": "MIT",
            "tags": [],
            "dependencies": {},
            "keywords": [],
        }

        if proj_author:
            manifest["author"] = proj_author

        prompd_files = [f for f in source_dir.glob("**/*.prmd") if f.is_file()]
        pdflow_files = [f for f in source_dir.glob("**/*.pdflow") if f.is_file()]

        if prompd_files:
            main_file = str(prompd_files[0].relative_to(source_dir)).replace("\\", "/")
            manifest["main"] = main_file
            if len(prompd_files) > 1:
                additional_files = [str(f.relative_to(source_dir)).replace("\\", "/") for f in prompd_files[1:]]
                manifest["files"] = additional_files

        if pdflow_files:
            manifest["workflows"] = [
                str(f.relative_to(source_dir)).replace("\\", "/") for f in pdflow_files
            ]

        create_pdpkg(source_dir, output_path, manifest)

        console.print("[bold green]Package created successfully![/bold green]")
        console.print(f"   Package: [cyan]{output_path}[/cyan]")
        console.print(f"   Size: {output_path.stat().st_size / 1024:.1f} KB")

        validate_pdpkg(output_path)
        console.print("[green]Package validation passed[/green]")
    except Exception as exc:
        console.print(f"[bold red]Package creation failed:[/bold red] {exc}")
        raise SystemExit(1)


@package.command("validate")
@click.argument("package_path", type=click.Path(exists=True, path_type=Path))
def package_validate(package_path: Path):
    """Validate a .pdpkg package archive."""
    try:
        from prompd.package_validator import validate_package

        if not package_path.name.endswith(".pdpkg"):
            console.print("[red]ERROR[/red] [bold red]Invalid package format![/bold red]")
            console.print(f"   File: {package_path.name}")
            console.print("   Expected: .pdpkg archive file")
            console.print("   Note: .prmd files are individual prompts, not packages")
            console.print("   Use 'prompd validate' to validate individual .prmd files")
            raise SystemExit(1)

        console.print(f"[blue]INFO[/blue] Validating package: [cyan]{package_path.name}[/cyan]")

        result = validate_package(package_path)

        if result.is_valid:
            console.print("[green]SUCCESS[/green] [bold green]Package validation passed![/bold green]")

            if result.package_info:
                info = result.package_info
                console.print(f"   Package: [cyan]{info.get('name', 'unknown')}[/cyan]")
                console.print(f"   Version: [green]{info.get('version', 'unknown')}[/green]")
                console.print(f"   Description: {info.get('description', 'No description')}")
                if "parameters" in info:
                    console.print(f"   Parameters: {len(info['parameters'])}")
        else:
            console.print("[red]ERROR[/red] [bold red]Package validation failed![/bold red]")
            for error in result.errors:
                console.print(f"   - [red]{error}[/red]")

        if result.warnings:
            console.print("\n[yellow]WARNINGS:[/yellow]")
            for warning in result.warnings:
                console.print(f"   - [yellow]{warning}[/yellow]")

        if not result.is_valid:
            raise SystemExit(1)
    except Exception as exc:
        console.print(f"[red]ERROR[/red] [bold red]Validation failed:[/bold red] {exc}")
        raise SystemExit(1)


__all__ = ["package"]
