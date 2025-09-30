"""List package versions command."""
from __future__ import annotations

from typing import Optional

import click
from rich.table import Table

from prompd.commands.common import console


@click.command(name="versions")
@click.argument("package_name", required=True)
@click.option("--registry", help="Registry to query")
def versions(package_name: str, registry: Optional[str]):
    """List available versions of a package."""
    try:
        from prompd.registry import RegistryClient

        client = RegistryClient(registry_name=registry)
        versions_list = client.get_package_versions(package_name)

        if not versions_list:
            console.print(f"[yellow]No versions found for {package_name}[/yellow]")
            return

        console.print(f"\n[bold]Available versions for {package_name}:[/bold]\n")

        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("Version", style="green")
        table.add_column("Published", style="blue")
        table.add_column("Tags", style="yellow")

        for version_info in versions_list:
            table.add_row(
                version_info.get("version", "Unknown"),
                version_info.get("published_at", "Unknown")[:10],
                ", ".join(version_info.get("tags", [])),
            )

        console.print(table)
    except Exception as exc:
        console.print(f"[red]Failed to get versions:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["versions"]
