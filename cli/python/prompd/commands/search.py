"""Search command for Prompd registry packages."""
from __future__ import annotations

from typing import Optional

import click
from rich.table import Table

from prompd.commands.common import console


@click.command(name="search")
@click.argument("query", required=True)
@click.option("-l", "--limit", default=20, help="Maximum number of results")
@click.option("--registry", help="Registry to search in")
def search(query: str, limit: int, registry: Optional[str]):
    """Search packages in registry."""
    try:
        from prompd.registry import RegistryClient

        client = RegistryClient(registry_name=registry)
        results = client.search(query, limit=limit)

        if not results:
            console.print(f"[yellow]No packages found matching '{query}'[/yellow]")
            return

        console.print(f"\n[bold]Found {len(results)} packages:[/bold]\n")

        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("Package", style="cyan")
        table.add_column("Version", style="green")
        table.add_column("Description", style="white")
        table.add_column("Downloads", justify="right", style="yellow")

        for pkg in results:
            package_name = pkg.get("fullName", pkg.get("name", "Unknown"))
            version = (
                pkg.get("latestVersion")
                or pkg.get("latest_version")
                or pkg.get("version")
                or pkg.get("currentVersion")
                or "Unknown"
            )
            downloads = pkg.get("downloads30d", pkg.get("downloads", 0))
            description = pkg.get("description", "")
            if len(description) > 50:
                description = description[:50] + "..."

            table.add_row(package_name, version, description, str(downloads))

        console.print(table)
    except Exception as exc:
        console.print(f"[red]Search failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["search"]
