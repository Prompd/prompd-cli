"""Package management commands."""

import json
import zipfile
from pathlib import Path
from typing import Dict, Any

import click
from rich.console import Console
from rich.table import Table

from ..registry import RegistryClient, validate_pdpkg
from ..exceptions import PrompdError
from ..security import validate_file_path, SecurityError

console = Console()


@click.group()
def package():
    """Package management (create, validate, install)."""
    pass


@package.command('validate')
@click.argument('package_file', type=click.Path(exists=True))
def validate_package(package_file: str):
    """Validate a .pdpkg package."""
    try:
        package_path = Path(package_file)
        safe_path = validate_file_path(package_path)
        
        if not safe_path.suffix == '.pdpkg':
            console.print(f"[red]File must have .pdpkg extension[/red]")
            return
        
        # Validate package
        result = validate_pdpkg(safe_path)
        
        if result["valid"]:
            console.print(f"[green]✓[/green] Package is valid")
            
            # Show package info
            manifest = result.get("manifest", {})
            
            info_content = f"""
[bold cyan]Name:[/bold cyan] {manifest.get('name', 'Unknown')}
[bold cyan]Version:[/bold cyan] {manifest.get('version', 'Unknown')}
[bold cyan]Description:[/bold cyan] {manifest.get('description', 'No description')}
[bold cyan]Files:[/bold cyan] {len(manifest.get('files', []))}
"""
            
            from rich.panel import Panel
            console.print(Panel(info_content.strip(), title="Package Information"))
            
            # Show files
            if manifest.get('files'):
                table = Table(title="Package Files")
                table.add_column("File", style="cyan")
                
                for file_name in sorted(manifest['files']):
                    table.add_row(file_name)
                
                console.print(table)
        
        else:
            console.print(f"[red]✗[/red] Package validation failed")
            for error in result.get("errors", []):
                console.print(f"  [red]•[/red] {error}")
    
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")
    except Exception as e:
        console.print(f"[red]Error validating package: {e}[/red]")