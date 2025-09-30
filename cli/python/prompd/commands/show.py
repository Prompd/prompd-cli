"""Implementation of the `prompd show` command."""
from __future__ import annotations

from pathlib import Path

import click
from rich.panel import Panel
from rich.table import Table

from prompd.commands.common import console


@click.command(name="show")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--sections", is_flag=True, help="Show available section IDs for override reference")
@click.option("--verbose", is_flag=True, help="Show detailed section information")
def show(file: Path, sections: bool, verbose: bool):
    """Show the structure and parameters of a .prmd file."""
    try:
        from prompd.parser import PrompdParser

        parser = PrompdParser()
        prompd = parser.parse_file(file)
        metadata = prompd.metadata

        console.print(Panel(f"[bold cyan]{metadata.name}[/bold cyan]", subtitle=f"Version: {metadata.version or 'N/A'}"))

        if metadata.description:
            console.print(f"\n[bold]Description:[/bold] {metadata.description}\n")

        if metadata.parameters:
            table = Table(title="Parameters")
            table.add_column("Name", style="cyan")
            table.add_column("Type", style="green")
            table.add_column("Required", style="yellow")
            table.add_column("Default")
            table.add_column("Description")

            for param in metadata.parameters:
                table.add_row(
                    param.name,
                    param.type.value,
                    "Yes" if param.required else "No",
                    str(param.default or "")[:20],
                    param.description[:40] if param.description else "",
                )
            console.print(table)

        content_info = []
        if metadata.system:
            content_info.append(f"System: {metadata.system}")
        if metadata.context:
            content_info.append(f"Context: {metadata.context}")
        if metadata.user:
            content_info.append(f"User: {metadata.user}")
        if metadata.response:
            content_info.append(f"Response: {metadata.response}")

        if content_info:
            console.print("\n[bold]Content Structure:[/bold]")
            for info in content_info:
                console.print(f"  -{info}")

        if sections:
            try:
                section_summary = parser.get_section_summary(file)

                if section_summary:
                    sections_table = Table(title="Available Sections for Override")
                    sections_table.add_column("Section ID", style="cyan", min_width=20)
                    sections_table.add_column("Heading Text", style="green", min_width=30)
                    if verbose:
                        sections_table.add_column("Content Length", style="yellow", justify="right")

                    for section_id, heading_text, content_length in section_summary:
                        if verbose:
                            sections_table.add_row(section_id, heading_text, f"{content_length:,} chars")
                        else:
                            sections_table.add_row(section_id, heading_text)

                    console.print("\n")
                    console.print(sections_table)

                    console.print("\n[bold]Override Usage Example:[/bold]")
                    console.print("[dim]override:[/dim]")
                    if section_summary:
                        example_id = section_summary[0][0]
                        console.print(f"[dim]  {example_id}: \"./custom-{example_id}.md\"[/dim]")
                        console.print("[dim]  another-section: null  # Remove section[/dim]")
                else:
                    console.print(f"\n[yellow]No sections found in {file.name}[/yellow]")
                    console.print("[dim]Note: Only markdown headings (# Header) create sections[/dim]")
            except Exception as exc:
                console.print(f"\n[red]Error extracting sections:[/red] {exc}")
        else:
            if prompd.sections:
                console.print("\n[bold]Available Sections:[/bold]")
                for section_name in prompd.sections:
                    console.print(f"  -#{section_name}")

            if metadata and hasattr(metadata, "inherits") and metadata.inherits:
                console.print(f"\n[bold]Inherits from:[/bold] {metadata.inherits}")
                if hasattr(metadata, "override") and metadata.override:
                    console.print("\n[bold]Section Overrides:[/bold]")
                    for section_id, override_path in metadata.override.items():
                        if override_path is None:
                            console.print(f"  -[red]{section_id}[/red]: [removed]")
                        else:
                            console.print(f"  -[cyan]{section_id}[/cyan]: {override_path}")

        if metadata.requires:
            console.print(f"\n[bold]Requirements:[/bold] {', '.join(metadata.requires)}")
    except Exception as exc:
        console.print(f"[red]Error reading file:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["show"]
