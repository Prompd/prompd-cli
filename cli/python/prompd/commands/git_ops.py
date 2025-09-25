"""Git integration commands."""

import subprocess
from pathlib import Path
from typing import List, Dict

import click
from rich.console import Console
from rich.table import Table

from ..exceptions import PrompdError
from ..security import validate_git_file_path, validate_git_message, validate_version_string, SecurityError

console = Console()


@click.group(name="git")
def git_group():
    """Git integration commands."""
    pass


@git_group.command("add")
@click.argument('files', nargs=-1, required=True)
def git_add(files):
    """Add files to git staging."""
    try:
        for file in files:
            safe_path = validate_git_file_path(file)
            subprocess.run(["git", "add", safe_path], check=True)
            console.print(f"[green]✓[/green] Added {safe_path}")
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Git error: {e}[/red]")


@git_group.command("remove")
@click.argument('files', nargs=-1, required=True)  
def git_remove(files):
    """Remove files from git tracking."""
    try:
        for file in files:
            safe_path = validate_git_file_path(file)
            subprocess.run(["git", "rm", "--cached", safe_path], check=True)
            console.print(f"[green]✓[/green] Removed {safe_path} from git")
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Git error: {e}[/red]")


@git_group.command("status")
def git_status():
    """Show git status for .prmd files."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True,
            text=True,
            check=True
        )
        
        if not result.stdout.strip():
            console.print("[green]No changes detected[/green]")
            return
        
        table = Table(title="Git Status")
        table.add_column("Status", style="cyan")
        table.add_column("File", style="yellow") 
        
        for line in result.stdout.strip().split('\n'):
            if line and ('.prmd' in line or '.pdflow' in line):
                status = line[:2]
                file_path = line[3:]
                
                # Color code the status
                if status == '??':
                    status_display = "[red]??[/red] (untracked)"
                elif 'M' in status:
                    status_display = "[yellow]M[/yellow] (modified)"
                elif 'A' in status:
                    status_display = "[green]A[/green] (added)"
                elif 'D' in status:
                    status_display = "[red]D[/red] (deleted)"
                else:
                    status_display = status
                
                table.add_row(status_display, file_path)
        
        console.print(table)
        
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Git error: {e}[/red]")


@git_group.command("commit")
@click.option('-m', '--message', required=True, help='Commit message')
@click.option('--auto-add', is_flag=True, help='Automatically add modified .prmd files')
def git_commit(message: str, auto_add: bool):
    """Commit changes with validation."""
    try:
        # Auto-add .prmd files if requested
        if auto_add:
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                capture_output=True,
                text=True,
                check=True
            )
            
            for line in result.stdout.strip().split('\n'):
                if line and '.prmd' in line and line[0] == ' ' and line[1] == 'M':
                    file_path = line[3:]
                    try:
                        safe_path = validate_git_file_path(file_path)
                        subprocess.run(["git", "add", safe_path], check=True)
                        console.print(f"[dim]Auto-staging: {safe_path}[/dim]")
                    except SecurityError as e:
                        console.print(f"[red]Security warning: Skipping unsafe file path: {e}[/red]")
                        continue
        
        # Commit with validated message
        try:
            safe_message = validate_git_message(message)
        except SecurityError as e:
            console.print(f"[red]Error: Invalid commit message: {e}[/red]")
            raise click.Abort()
        
        result = subprocess.run(
            ["git", "commit", "-m", safe_message],
            capture_output=True,
            text=True,
            check=True
        )
        
        console.print(f"[green]OK[/green] Committed changes")
        if result.stdout:
            # Extract commit hash and stats
            lines = result.stdout.strip().split('\n')
            for line in lines:
                if 'file' in line and 'changed' in line:
                    console.print(f"[dim]{line}[/dim]")
        
    except subprocess.CalledProcessError as e:
        if 'nothing to commit' in e.stdout.decode() if e.stdout else '':
            console.print("[yellow]Nothing to commit[/yellow]")
        else:
            console.print(f"[red]Git error: {e}[/red]")
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")


@git_group.command("checkout")
@click.argument('file')
@click.argument('version')
def git_checkout(file: str, version: str):
    """Checkout a specific version of a file from git history."""
    try:
        safe_file = validate_git_file_path(file)
        safe_version = validate_version_string(version) if version.count('.') == 2 else version
        
        # Find the tag for this version
        result = subprocess.run(
            ["git", "tag", "--list", f"*{safe_version}"],
            capture_output=True,
            text=True,
            check=True
        )
        
        tags = [tag.strip() for tag in result.stdout.split('\n') if tag.strip()]
        
        if not tags:
            console.print(f"[red]No tags found for version {safe_version}[/red]")
            return
        
        # Use the first matching tag
        tag = tags[0]
        
        result = subprocess.run(
            ["git", "show", f"{tag}:{safe_file}"],
            capture_output=True,
            text=True,
            check=True
        )
        
        # Write the content to a temporary file
        version_file = Path(safe_file).with_suffix(f'.{safe_version}.prmd')
        version_file.write_text(result.stdout, encoding='utf-8')
        
        console.print(f"[green]✓[/green] Checked out version {safe_version} to {version_file}")
        
    except SecurityError as e:
        console.print(f"[red]Security error: {e}[/red]")
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Git error: {e}[/red]")


def _git_commit_and_tag(file_path: Path, version: str, message: str):
    """Create git commit and tag."""
    try:
        # Validate inputs for security
        safe_path = validate_git_file_path(str(file_path))
        safe_message = validate_git_message(message)
        safe_version = validate_version_string(version)
        
        # Add file to git
        subprocess.run(["git", "add", safe_path], check=True, capture_output=True)
        
        # Commit
        subprocess.run(["git", "commit", "-m", safe_message], check=True, capture_output=True)
        
        # Create tag (validate tag name components)
        safe_stem = validate_git_file_path(file_path.stem)
        tag_name = f"{safe_stem}-v{safe_version}"
        subprocess.run(["git", "tag", tag_name], check=True, capture_output=True)
        
    except SecurityError as e:
        raise Exception(f"Security validation failed: {e}")
    except subprocess.CalledProcessError as e:
        raise Exception(f"Git operation failed: {e.stderr.decode()}")


def _get_git_tags(file_path: Path, limit: int) -> List[Dict[str, str]]:
    """Get git tags related to a file."""
    try:
        # Get all tags
        result = subprocess.run(
            ["git", "tag", "--sort=-version:refname"],
            capture_output=True,
            text=True,
            check=True
        )
        
        tags = []
        file_stem = file_path.stem
        
        for tag in result.stdout.strip().split('\n'):
            if tag and file_stem in tag:
                # Get tag info
                tag_info_result = subprocess.run(
                    ["git", "show", "--format=%ai|%an|%s", "--name-only", tag],
                    capture_output=True,
                    text=True,
                    check=True
                )
                
                lines = tag_info_result.stdout.strip().split('\n')
                if lines:
                    info_line = lines[0]
                    parts = info_line.split('|')
                    if len(parts) >= 3:
                        tags.append({
                            'tag': tag,
                            'date': parts[0],
                            'author': parts[1],
                            'message': parts[2]
                        })
                
                if len(tags) >= limit:
                    break
        
        return tags
        
    except subprocess.CalledProcessError:
        return []