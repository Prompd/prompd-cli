"""Implementation of the `prompd list` command."""
from __future__ import annotations

from pathlib import Path

import click
from rich.table import Table

from prompd.commands.common import console


@click.command(name="list")
@click.option(
    "--path",
    "-p",
    type=click.Path(exists=True, path_type=Path),
    default=Path("."),
    help="Directory to search for .prmd files",
)
@click.option("--detailed", "-d", is_flag=True, help="Show detailed information")
@click.option("--recursive", "-r", is_flag=True, help="Search recursively in subdirectories")
def list_prompts(path: Path, detailed: bool, recursive: bool):
    """List available .prmd files."""
    try:
        from prompd.parser import PrompdParser

        prompd_files = list(Path(path).glob("**/*.prmd")) if recursive else list(Path(path).glob("*.prmd"))

        if not prompd_files:
            console.print(f"No .prmd files found in {path}")
            return

        parser = PrompdParser()

        if detailed:
            from rich.panel import Panel

            for prompd_file in prompd_files:
                try:
                    prompd = parser.parse_file(prompd_file)
                    metadata = prompd.metadata

                    console.print(
                        Panel(
                            f"[bold]{metadata.name or prompd_file.stem}[/bold]\n"
                            f"[dim]File:[/dim] {prompd_file}\n"
                            f"[dim]Description:[/dim] {metadata.description or 'No description'}\n"
                            f"[dim]Version:[/dim] {metadata.version or 'N/A'}\n"
                            f"[dim]Variables:[/dim] {', '.join(p.name for p in metadata.parameters)}",
                            border_style="blue",
                        )
                    )
                except Exception as exc:
                    console.print(f"[red]Error reading {prompd_file}:[/red] {exc}")
        else:
            table = Table(title=f"Prompd Files in {path}")
            table.add_column("Name", style="cyan")
            table.add_column("File", style="green")
            table.add_column("Description")

            for prompd_file in prompd_files:
                try:
                    prompd = parser.parse_file(prompd_file)
                    metadata = prompd.metadata
                    description = metadata.description or ""
                    if len(description) > 60:
                        description = description[:60] + "..."
                    table.add_row(
                        metadata.name or prompd_file.stem,
                        str(prompd_file),
                        description,
                    )
                except Exception:
                    table.add_row(prompd_file.stem, str(prompd_file), "[red]Error reading file[/red]")

            console.print(table)
    except Exception as exc:
        console.print(f"[red]Error listing files:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["list_prompts"]
