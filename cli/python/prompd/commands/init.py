"""Project initialisation command for Prompd."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import click
from rich.console import Console


@click.command(name="init")
@click.argument("path", default=".", type=click.Path(path_type=Path))
@click.option("--name", help="Project name (default: directory name)")
@click.option("--version", default="1.0.0", help="Initial version (default: 1.0.0)")
@click.option("--description", help="Project description")
@click.option("--author", help="Project author")
def init(path: Path, name: Optional[str], version: str, description: Optional[str], author: Optional[str]):
    """Initialize a new Prompd project with manifest.json."""
    console = Console()

    project_dir = path.resolve()

    if not project_dir.exists():
        project_dir.mkdir(parents=True, exist_ok=True)
        console.print(f"[green]OK[/green] Created directory: {project_dir}")

    manifest_path = project_dir / "manifest.json"
    if manifest_path.exists():
        console.print(f"[yellow]Warning:[/yellow] manifest.json already exists in {project_dir}")
        if not click.confirm("Overwrite existing manifest.json?"):
            console.print("[red]Aborted[/red]")
            return

    default_name = name or project_dir.name.lower().replace(" ", "-").replace("_", "-")
    default_description = description or f"Prompd project: {default_name}"
    default_author = author or "unknown"

    manifest_data = {
        "name": default_name,
        "version": version,
        "description": default_description,
        "author": default_author,
        "files": [
            "*.prmd",
            "*.md",
            "templates/",
            "docs/",
            "examples/",
        ],
        "ignore": ["*.log", "*.tmp", ".env*"],
        "dependencies": {},
        "devDependencies": {},
    }

    with open(manifest_path, "w", encoding="utf-8") as manifest_file:
        json.dump(manifest_data, manifest_file, indent=2, ensure_ascii=False)

    console.print(f"[green]OK[/green] Created manifest.json")
    console.print(f"[green]OK[/green] Initialized Prompd project: {default_name}")

    sample_prmd = project_dir / "example.prmd"
    if not any(project_dir.glob("*.prmd")):
        sample_content = f"""---
name: {default_name}-example
version: {version}
description: Example prompt for {default_name}
parameters:
  name:
    type: string
    required: true
    description: Name to greet
---

# Example Prompt

Hello {{{{ name }}}}! Welcome to {default_name}.

This is an example .prmd file to get you started.

## Usage
```bash
prompd run example.prmd --provider openai --model gpt-4o -p name="World"
```
"""
        sample_prmd.write_text(sample_content, encoding="utf-8")
        console.print(f"[green]OK[/green] Created sample prompt: {sample_prmd.name}")


__all__ = ["init"]
