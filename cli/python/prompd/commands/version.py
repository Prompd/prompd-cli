"""Version management commands."""

import subprocess
import yaml
from pathlib import Path
from typing import List, Dict

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from ..parser import PrompdParser
from ..exceptions import PrompdError
from ..security import validate_git_file_path, validate_git_message, validate_version_string, SecurityError
from .git_ops import _git_commit_and_tag, _get_git_tags

console = Console()


@click.group()
def version():
    """Version management for .prmd files."""
    pass


@version.command("bump")
@click.argument('file', type=click.Path(exists=True))
@click.argument('increment', type=click.Choice(['major', 'minor', 'patch']))
@click.option('--commit', is_flag=True, help='Create git commit and tag')
@click.option('--message', help='Custom commit message')
def version_bump(file: str, increment: str, commit: bool, message: str):
    """Bump version number in a .prmd file."""
    try:
        file_path = Path(file)
        safe_path = validate_git_file_path(str(file_path))
        
        # Parse current file
        parser = PrompdParser()
        result = parser.parse_file(file_path)
        
        current_version = result.metadata.get('version', '0.0.0')
        
        # Parse version
        parts = current_version.split('.')
        if len(parts) != 3:
            console.print(f"[red]Invalid version format: {current_version}[/red]")
            console.print("Expected semantic version (major.minor.patch)")
            return
        
        major, minor, patch = map(int, parts)
        
        # Increment based on type
        if increment == 'major':
            major += 1
            minor = 0
            patch = 0
        elif increment == 'minor':
            minor += 1  
            patch = 0
        else:  # patch
            patch += 1
        
        new_version = f"{major}.{minor}.{patch}"
        
        # Validate new version
        validate_version_string(new_version)
        
        # Update file
        _update_version_in_file(file_path, new_version)
        
        console.print(f"[green]✓[/green] Updated {file_path.name}")
        console.print(f"  {current_version} → [bold]{new_version}[/bold]")
        
        # Commit if requested
        if commit:
            if not message:
                message = f"Bump {file_path.stem} to v{new_version}"
            
            _git_commit_and_tag(file_path, new_version, message)
            console.print(f"[green]✓[/green] Created commit and tag")
    
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


@version.command("history")
@click.argument('file', type=click.Path(exists=True))
@click.option('--limit', default=10, help='Number of versions to show')
def version_history(file: str, limit: int):
    """Show version history for a file."""
    try:
        file_path = Path(file)
        safe_path = validate_git_file_path(str(file_path))
        
        tags = _get_git_tags(file_path, limit)
        
        if not tags:
            console.print(f"[yellow]No version history found for {file_path.name}[/yellow]")
            return
        
        table = Table(title=f"Version History: {file_path.name}")
        table.add_column("Tag", style="cyan")
        table.add_column("Date", style="green")
        table.add_column("Author", style="yellow")
        table.add_column("Message", style="white")
        
        for tag_info in tags:
            table.add_row(
                tag_info['tag'],
                tag_info['date'][:10],  # Just the date part
                tag_info['author'],
                tag_info['message'][:50] + "..." if len(tag_info['message']) > 50 else tag_info['message']
            )
        
        console.print(table)
    
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


@version.command("diff")
@click.argument('file', type=click.Path(exists=True))
@click.argument('version1')
@click.argument('version2')
def version_diff(file: str, version1: str, version2: str):
    """Show differences between two versions."""
    try:
        file_path = Path(file)
        safe_path = validate_git_file_path(str(file_path))
        
        # Get git tags for versions
        file_stem = file_path.stem
        tag1 = f"{file_stem}-v{version1}"
        tag2 = f"{file_stem}-v{version2}"
        
        result = subprocess.run(
            ["git", "diff", f"{tag1}:{safe_path}", f"{tag2}:{safe_path}"],
            capture_output=True,
            text=True,
            check=True
        )
        
        if not result.stdout:
            console.print("[yellow]No differences found[/yellow]")
            return
        
        console.print(f"[bold]Differences between {version1} and {version2}:[/bold]")
        console.print(result.stdout)
    
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Git error: {e}[/red]")


@version.command("validate")
@click.argument('file', type=click.Path(exists=True))
def version_validate(file: str):
    """Validate version format in a .prmd file."""
    try:
        file_path = Path(file)
        safe_path = validate_git_file_path(str(file_path))
        
        # Parse file
        parser = PrompdParser()
        result = parser.parse_file(file_path)
        
        version = result.metadata.get('version')
        
        if not version:
            console.print(f"[red]No version found in {file_path.name}[/red]")
            return
        
        # Validate version format
        validate_version_string(version)
        console.print(f"[green]✓[/green] Version {version} is valid")
    
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]") 
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


@version.command("suggest")
@click.argument('file', type=click.Path(exists=True))
def version_suggest(file: str):
    """AI-powered version bump suggestions based on changes."""
    try:
        file_path = Path(file)
        safe_path = validate_git_file_path(str(file_path))
        
        # Get current version
        parser = PrompdParser()
        result = parser.parse_file(file_path)
        current_version = result.metadata.get('version', '0.0.0')
        
        # Get recent changes
        try:
            git_result = subprocess.run(
                ["git", "diff", "HEAD~1", str(file_path)],
                capture_output=True,
                text=True,
                check=True
            )
            changes = git_result.stdout
        except subprocess.CalledProcessError:
            console.print("[yellow]No git history found for suggestions[/yellow]")
            return
        
        # Simple heuristic-based suggestions (placeholder for AI analysis)
        lines_added = len([line for line in changes.split('\n') if line.startswith('+')])
        lines_removed = len([line for line in changes.split('\n') if line.startswith('-')])
        
        # Analyze changes
        if '# System' in changes or '# User' in changes:
            suggestion = 'major'
            reason = "Core prompt logic changed"
        elif 'parameters:' in changes or 'required:' in changes:
            suggestion = 'minor' 
            reason = "Parameters or requirements modified"
        elif lines_added > 10 or lines_removed > 10:
            suggestion = 'minor'
            reason = "Significant content changes"
        else:
            suggestion = 'patch'
            reason = "Minor updates or fixes"
        
        # Calculate suggested version
        parts = current_version.split('.')
        major, minor, patch = map(int, parts)
        
        if suggestion == 'major':
            suggested_version = f"{major + 1}.0.0"
        elif suggestion == 'minor':
            suggested_version = f"{major}.{minor + 1}.0"
        else:
            suggested_version = f"{major}.{minor}.{patch + 1}"
        
        panel_content = f"""
[bold]Current Version:[/bold] {current_version}
[bold]Suggested Bump:[/bold] {suggestion}
[bold]Suggested Version:[/bold] {suggested_version}
[bold]Reason:[/bold] {reason}

[dim]Changes detected:[/dim]
  • {lines_added} lines added
  • {lines_removed} lines removed
"""
        
        console.print(Panel(panel_content.strip(), title="Version Suggestion"))
        
        # Ask for confirmation
        if click.confirm(f"Apply suggested version bump ({current_version} → {suggested_version})?"):
            _update_version_in_file(file_path, suggested_version)
            console.print(f"[green]✓[/green] Updated to version {suggested_version}")
    
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")
    except Exception as e:
        console.print(f"[red]Error: {e}[/red]")


def _update_version_in_file(file_path: Path, new_version: str):
    """Update version in YAML frontmatter."""
    content = file_path.read_text(encoding='utf-8')
    
    if not content.startswith('---'):
        raise PrompdError("File does not have YAML frontmatter")
    
    # Find end of frontmatter
    yaml_end = content.find('\n---\n', 3)
    if yaml_end == -1:
        raise PrompdError("Invalid YAML frontmatter")
    
    frontmatter = content[3:yaml_end]
    markdown_content = content[yaml_end + 4:]
    
    # Update version in frontmatter
    metadata = yaml.safe_load(frontmatter) or {}
    metadata['version'] = new_version
    
    # Write back
    updated_content = f"---\n{yaml.dump(metadata, default_flow_style=False)}---{markdown_content}"
    file_path.write_text(updated_content, encoding='utf-8')