"""Package management commands."""

import json
import zipfile
from pathlib import Path
from typing import Dict, Any

import click
from rich.console import Console
from rich.table import Table

from ..registry import RegistryClient, validate_pdpkg
from ..exceptions import PrompDError
from ..security import validate_file_path, SecurityError

console = Console()


@click.group()
def package():
    """Package management (create, validate, install)."""
    pass


@package.command('create')
@click.argument('directory', type=click.Path(exists=True, file_okay=False))
@click.option('-o', '--output', help='Output package file (.pdpkg)')
@click.option('--exclude', multiple=True, help='Patterns to exclude')
def create_package(directory: str, output: str, exclude: tuple):
    """Create a .pdpkg package from a directory."""
    try:
        dir_path = Path(directory)
        safe_dir = validate_file_path(dir_path)
        
        if not output:
            output = f"{dir_path.name}.pdpkg"
        
        output_path = Path(output)
        if not output_path.suffix == '.pdpkg':
            output_path = output_path.with_suffix('.pdpkg')
        
        # Find all .prmd and related files
        files_to_include = []
        
        # Include patterns
        include_patterns = [
            '*.prmd',
            '*.prompd', 
            '*.pdflow',
            '*.json',
            '*.yaml', 
            '*.yml',
            'README.md',
            'LICENSE*'
        ]
        
        for pattern in include_patterns:
            files_to_include.extend(safe_dir.glob(pattern))
            files_to_include.extend(safe_dir.glob(f"**/{pattern}"))
        
        # Remove duplicates and filter exclusions
        files_to_include = list(set(files_to_include))
        
        # Apply exclusions
        for exclude_pattern in exclude:
            files_to_include = [f for f in files_to_include if not f.match(exclude_pattern)]
        
        # Exclude .pdproj files (like .csproj from NuGet)
        files_to_include = [f for f in files_to_include if not f.suffix == '.pdproj']
        
        if not files_to_include:
            console.print(f"[red]No files found to package in {directory}[/red]")
            return
        
        # Generate manifest
        manifest = {
            "name": dir_path.name,
            "version": "1.0.0",  # Default version
            "description": f"Package created from {directory}",
            "files": []
        }
        
        # Look for existing manifest or .prmd with metadata
        manifest_file = safe_dir / 'manifest.json'
        if manifest_file.exists():
            try:
                with open(manifest_file, 'r', encoding='utf-8') as f:
                    existing_manifest = json.load(f)
                    manifest.update(existing_manifest)
            except Exception as e:
                console.print(f"[yellow]Warning: Could not read existing manifest: {e}[/yellow]")
        
        # Create package
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Add files
            for file_path in files_to_include:
                arcname = file_path.relative_to(safe_dir)
                zipf.write(file_path, arcname)
                manifest["files"].append(str(arcname))
            
            # Add manifest
            zipf.writestr('manifest.json', json.dumps(manifest, indent=2))
        
        console.print(f"[green]✓[/green] Created package: {output_path}")
        console.print(f"  Files included: {len(files_to_include)}")
        
        # Show contents
        table = Table(title="Package Contents")
        table.add_column("File", style="cyan")
        table.add_column("Size", style="yellow")
        
        for file_path in sorted(files_to_include):
            size = file_path.stat().st_size
            table.add_row(str(file_path.relative_to(safe_dir)), f"{size:,} bytes")
        
        console.print(table)
    
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")
    except Exception as e:
        console.print(f"[red]Error creating package: {e}[/red]")


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