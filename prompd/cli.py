"""Command-line interface for Prompd."""

import sys
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, List

import click
from rich.console import Console
from rich.table import Table
from rich.syntax import Syntax
from rich.panel import Panel

from prompd.parser import PrompdParser
from prompd.validator import PrompDValidator
from prompd.executor import PrompDExecutor
from prompd.exceptions import PrompDError, ValidationError, ParseError, ProviderError, ConfigurationError

console = Console()


@click.group()
@click.version_option(version="0.1.0", prog_name="prompd")
def cli():
    """Prompd - CLI for structured prompt definitions."""
    pass


@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--provider", required=True, help="LLM provider (openai, anthropic, ollama)")
@click.option("--model", required=True, help="Model name")
@click.option("--param", "-p", multiple=True, help="Parameter in format key=value")
@click.option("--param-file", "-f", type=click.Path(exists=True, path_type=Path), 
              multiple=True, help="JSON parameter file")
@click.option("--api-key", help="API key override")
@click.option("--output", "-o", type=click.Path(), help="Output file path")
@click.option("--verbose", "-v", is_flag=True, help="Verbose output")
def execute(file: Path, provider: str, model: str, param: tuple, param_file: tuple, 
           api_key: Optional[str], output: Optional[str], verbose: bool):
    """Execute a .prompd file with an LLM provider."""
    import asyncio
    
    try:
        # Create executor
        executor = PrompDExecutor()
        
        # Convert parameters
        cli_params = list(param) if param else None
        param_files = [Path(p) for p in param_file] if param_file else None
        
        # Execute
        response = asyncio.run(executor.execute(
            prompd_file=file,
            provider=provider,
            model=model,
            cli_params=cli_params,
            param_files=param_files,
            api_key=api_key
        ))
        
        # Output result
        if output:
            with open(output, "w") as f:
                f.write(response.content)
            console.print(f"[green]OK[/green] Response written to {output}")
        else:
            console.print(Panel(
                response.content, 
                title=f"Response from {provider}/{model}",
                border_style="green"
            ))
            
            if verbose and response.usage:
                console.print(f"\n[dim]Usage: {response.usage}[/dim]")
            
    except ConfigurationError as e:
        console.print(f"[red]Configuration Error:[/red] {e}")
        sys.exit(1)
    except ProviderError as e:
        console.print(f"[red]Provider Error:[/red] {e}")
        sys.exit(1)
    except PrompDError as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)
    except Exception as e:
        console.print(f"[red]Unexpected error:[/red] {e}")
        if verbose:
            import traceback
            console.print(traceback.format_exc())
        sys.exit(1)




@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--verbose", "-v", is_flag=True, help="Show detailed validation results")
@click.option("--git", is_flag=True, help="Include git history consistency checks")
@click.option("--version-only", is_flag=True, help="Only validate version-related aspects")
def validate(file: Path, verbose: bool, git: bool, version_only: bool):
    """Validate a .prompd file syntax and structure."""
    try:
        validator = PrompDValidator()
        
        if version_only:
            # Only check version consistency
            issues = validator.validate_version_consistency(file, check_git=git)
        else:
            # Full validation
            issues = validator.validate_file(file)
            if git:
                # Add git consistency checks
                git_issues = validator.validate_version_consistency(file, check_git=True)
                issues.extend(git_issues)
        
        if not issues:
            console.print(f"[green]OK[/green] {file} is valid")
        else:
            # Group issues by level
            errors = [i for i in issues if i.get("level") == "error"]
            warnings = [i for i in issues if i.get("level") == "warning"]
            info = [i for i in issues if i.get("level") == "info"]
            
            if errors:
                console.print(f"[red]ERRORS[/red] ({len(errors)}):")
                for issue in errors:
                    console.print(f"  [red]-[/red] {issue['message']}")
            
            if warnings:
                console.print(f"[yellow]WARNINGS[/yellow] ({len(warnings)}):")
                for issue in warnings:
                    console.print(f"  [yellow]-[/yellow] {issue['message']}")
            
            if info and verbose:
                console.print(f"[blue]INFO[/blue] ({len(info)}):")
                for issue in info:
                    console.print(f"  [blue]-[/blue] {issue['message']}")
            
            sys.exit(1 if errors else 0)
            
    except Exception as e:
        console.print(f"[red]Error validating file:[/red] {e}")
        sys.exit(1)


@cli.command("list")
@click.option("--path", "-p", type=click.Path(exists=True, path_type=Path), 
              default=Path("prompts"), help="Directory to search for .prompd files")
@click.option("--detailed", "-d", is_flag=True, help="Show detailed information")
def list_prompts(path: Path, detailed: bool):
    """List available .prompd files."""
    try:
        prompd_files = list(Path(path).glob("**/*.prompd"))
        
        if not prompd_files:
            console.print(f"No .prompd files found in {path}")
            return
        
        if detailed:
            for prompd_file in prompd_files:
                try:
                    parser = PrompdParser()
                    prompd = parser.parse_file(prompd_file)
                    metadata = prompd.metadata
                    
                    console.print(Panel(
                        f"[bold]{metadata.name or prompd_file.stem}[/bold]\n"
                        f"[dim]File:[/dim] {prompd_file}\n"
                        f"[dim]Description:[/dim] {metadata.description or 'No description'}\n"
                        f"[dim]Version:[/dim] {metadata.version or 'N/A'}\n"
                        f"[dim]Variables:[/dim] {', '.join(p.name for p in metadata.parameters)}",
                        border_style="blue"
                    ))
                except Exception as e:
                    console.print(f"[red]Error reading {prompd_file}:[/red] {e}")
        else:
            table = Table(title=f"Prompd Files in {path}")
            table.add_column("Name", style="cyan")
            table.add_column("File", style="green")
            table.add_column("Description")
            
            for prompd_file in prompd_files:
                try:
                    parser = PrompdParser()
                    prompd = parser.parse_file(prompd_file)
                    metadata = prompd.metadata
                    table.add_row(
                        metadata.name or prompd_file.stem,
                        str(prompd_file),
                        (metadata.description or "")[:60] + "..."
                        if len(metadata.description or "") > 60 else (metadata.description or "")
                    )
                except Exception:
                    table.add_row(prompd_file.stem, str(prompd_file), "[red]Error reading file[/red]")
            
            console.print(table)
            
    except Exception as e:
        console.print(f"[red]Error listing files:[/red] {e}")
        sys.exit(1)


@cli.command()
def providers():
    """List available LLM providers and their models."""
    try:
        executor = PrompDExecutor()
        available_providers = executor.get_available_providers()
        
        if not available_providers:
            console.print("[yellow]No providers available[/yellow]")
            return
        
        for provider_name in available_providers:
            models = executor.get_provider_models(provider_name)
            
            console.print(Panel(
                f"[bold]{provider_name}[/bold]\n"
                f"Models: {', '.join(models[:5])}"
                f"{' ...' if len(models) > 5 else ''}",
                title="Provider",
                border_style="blue"
            ))
            
    except Exception as e:
        console.print(f"[red]Error listing providers:[/red] {e}")
        sys.exit(1)


@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
def show(file: Path):
    """Show the structure and parameters of a .prompd file."""
    try:
        parser = PrompdParser()
        prompd = parser.parse_file(file)
        metadata = prompd.metadata
        
        console.print(Panel(f"[bold cyan]{metadata.name}[/bold cyan]", 
                           subtitle=f"Version: {metadata.version or 'N/A'}"))
        
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
                    param.description[:40] if param.description else ""
                )
            console.print(table)
        
        # Show content structure
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
            console.print(f"\n[bold]Content Structure:[/bold]")
            for info in content_info:
                console.print(f"  • {info}")
        
        # Show sections found in file
        if prompd.sections:
            console.print(f"\n[bold]Available Sections:[/bold]")
            for section_name in prompd.sections:
                console.print(f"  • #{section_name}")
        
        if metadata.requires:
            console.print(f"\n[bold]Requirements:[/bold] {', '.join(metadata.requires)}")
            
    except Exception as e:
        console.print(f"[red]Error reading file:[/red] {e}")
        sys.exit(1)


@cli.group()
def version():
    """Version management commands."""
    pass


@version.command("bump")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.argument("bump_type", type=click.Choice(["major", "minor", "patch"]))
@click.option("--message", "-m", help="Commit message")
@click.option("--dry-run", is_flag=True, help="Show what would be done without making changes")
def version_bump(file: Path, bump_type: str, message: Optional[str], dry_run: bool):
    """Bump version in a .prompd file and create git tag."""
    try:
        parser = PrompdParser()
        prompd = parser.parse_file(file)
        
        current_version = prompd.metadata.version or "0.0.0"
        new_version = _bump_version(current_version, bump_type)
        
        if dry_run:
            console.print(f"[dim]Would bump {file} from {current_version} to {new_version}[/dim]")
            return
        
        # Update version in file
        _update_version_in_file(file, new_version)
        
        # Git operations
        commit_msg = message or f"Bump {file.name} to {new_version}"
        _git_commit_and_tag(file, new_version, commit_msg)
        
        console.print(f"[green]OK[/green] Bumped {file.name} from {current_version} to {new_version}")
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@version.command("history")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--limit", "-n", type=int, default=10, help="Number of versions to show")
def version_history(file: Path, limit: int):
    """Show version history for a .prompd file."""
    try:
        tags = _get_git_tags(file, limit)
        
        if not tags:
            console.print(f"[yellow]No version tags found for {file}[/yellow]")
            return
        
        table = Table(title=f"Version History for {file}")
        table.add_column("Version", style="cyan")
        table.add_column("Date", style="green")
        table.add_column("Commit", style="yellow")
        table.add_column("Message")
        
        for tag_info in tags:
            table.add_row(
                tag_info["tag"],
                tag_info["date"],
                tag_info["commit"][:8],
                tag_info["message"][:60]
            )
        
        console.print(table)
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@version.command("diff")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.argument("version1")
@click.argument("version2", required=False)
def version_diff(file: Path, version1: str, version2: Optional[str]):
    """Show differences between versions of a .prompd file."""
    try:
        version2 = version2 or "HEAD"
        diff_output = _git_diff_versions(file, version1, version2)
        
        if not diff_output:
            console.print(f"[green]No differences between {version1} and {version2}[/green]")
            return
        
        syntax = Syntax(diff_output, "diff", theme="monokai", line_numbers=True)
        console.print(Panel(syntax, title=f"Diff: {version1} → {version2}"))
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@version.command("validate")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--git", is_flag=True, help="Validate against git history")
def version_validate(file: Path, git: bool):
    """Validate version consistency."""
    try:
        parser = PrompdParser()
        prompd = parser.parse_file(file)
        
        current_version = prompd.metadata.version
        if not current_version:
            console.print(f"[yellow]WARNING[/yellow] No version specified in {file}")
            return
        
        # Validate semantic version format
        if not _is_valid_semver(current_version):
            console.print(f"[red]ERROR[/red] Invalid semantic version: {current_version}")
            sys.exit(1)
        
        if git:
            # Check if version matches latest git tag
            latest_tag = _get_latest_git_tag(file)
            if latest_tag and latest_tag != current_version:
                console.print(f"[yellow]WARNING[/yellow] Version mismatch:")
                console.print(f"  File version: {current_version}")
                console.print(f"  Latest git tag: {latest_tag}")
        
        console.print(f"[green]OK[/green] Version {current_version} is valid")
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


@version.command("suggest")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--changes", help="Description of changes made")
def version_suggest(file: Path, changes: Optional[str]):
    """Suggest appropriate version bump based on changes."""
    try:
        parser = PrompdParser()
        validator = PrompDValidator()
        prompd = parser.parse_file(file)
        
        current_version = prompd.metadata.version or "0.0.0"
        suggestion = validator.suggest_version_bump(current_version, changes or "")
        
        console.print(Panel(
            f"[bold cyan]Current Version:[/bold cyan] {suggestion['suggestions']['current']}\\n\\n"
            f"[bold green]Suggested Bump:[/bold green] {suggestion['recommended']} -> "
            f"{suggestion['suggestions'][suggestion['recommended']]}\\n\\n"
            f"[bold]All Options:[/bold]\\n"
            f"  - Patch: {suggestion['suggestions']['patch']} (bug fixes)\\n"
            f"  - Minor: {suggestion['suggestions']['minor']} (new features)\\n"
            f"  - Major: {suggestion['suggestions']['major']} (breaking changes)\\n\\n"
            f"[dim]{suggestion['reason']}[/dim]",
            title="Version Bump Suggestions"
        ))
        
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        sys.exit(1)


def _bump_version(version: str, bump_type: str) -> str:
    """Bump semantic version."""
    parts = version.split(".")
    if len(parts) != 3:
        raise ValueError(f"Invalid semantic version: {version}")
    
    major, minor, patch = map(int, parts)
    
    if bump_type == "major":
        major += 1
        minor = 0
        patch = 0
    elif bump_type == "minor":
        minor += 1
        patch = 0
    elif bump_type == "patch":
        patch += 1
    
    return f"{major}.{minor}.{patch}"


def _is_valid_semver(version: str) -> bool:
    """Check if version follows semantic versioning."""
    import re
    pattern = r"^(\d+)\.(\d+)\.(\d+)$"
    return bool(re.match(pattern, version))


def _update_version_in_file(file_path: Path, new_version: str):
    """Update version field in .prompd file."""
    content = file_path.read_text(encoding='utf-8')
    
    # Parse YAML frontmatter
    import re
    if content.startswith('---\n'):
        # Find the end of frontmatter
        end_match = re.search(r'\n---\n', content[4:])
        if end_match:
            yaml_end = end_match.end() + 4
            frontmatter = content[4:yaml_end-5]  # Remove --- delimiters
            markdown_content = content[yaml_end:]
            
            # Update version in frontmatter
            import yaml
            metadata = yaml.safe_load(frontmatter) or {}
            metadata['version'] = new_version
            
            # Write back
            updated_content = f"---\n{yaml.dump(metadata, default_flow_style=False)}---\n{markdown_content}"
            file_path.write_text(updated_content, encoding='utf-8')


def _git_commit_and_tag(file_path: Path, version: str, message: str):
    """Create git commit and tag."""
    try:
        # Add file to git
        subprocess.run(["git", "add", str(file_path)], check=True, capture_output=True)
        
        # Commit
        subprocess.run(["git", "commit", "-m", message], check=True, capture_output=True)
        
        # Create tag
        tag_name = f"{file_path.stem}-v{version}"
        subprocess.run(["git", "tag", tag_name], check=True, capture_output=True)
        
    except subprocess.CalledProcessError as e:
        raise Exception(f"Git operation failed: {e.stderr.decode()}")


def _get_git_tags(file_path: Path, limit: int) -> List[Dict[str, str]]:
    """Get git tags related to a file."""
    try:
        # Get tags with commit info
        result = subprocess.run([
            "git", "log", "--tags", "--simplify-by-decoration", "--pretty=format:%d|%H|%ai|%s",
            "-n", str(limit), "--", str(file_path)
        ], capture_output=True, text=True, check=True)
        
        tags = []
        for line in result.stdout.split('\n'):
            if line.strip():
                parts = line.split('|', 3)
                if len(parts) == 4 and 'tag:' in parts[0]:
                    # Extract tag name
                    import re
                    tag_match = re.search(r'tag: ([^,)]+)', parts[0])
                    if tag_match:
                        tags.append({
                            'tag': tag_match.group(1).strip(),
                            'commit': parts[1],
                            'date': parts[2][:10],  # Just the date part
                            'message': parts[3]
                        })
        
        return tags
        
    except subprocess.CalledProcessError:
        return []


def _get_latest_git_tag(file_path: Path) -> Optional[str]:
    """Get latest git tag for a file."""
    tags = _get_git_tags(file_path, 1)
    return tags[0]['tag'] if tags else None


def _git_diff_versions(file_path: Path, version1: str, version2: str) -> str:
    """Get git diff between versions."""
    try:
        result = subprocess.run([
            "git", "diff", f"{file_path.stem}-v{version1}", f"{file_path.stem}-v{version2}",
            "--", str(file_path)
        ], capture_output=True, text=True, check=True)
        
        return result.stdout
        
    except subprocess.CalledProcessError as e:
        raise Exception(f"Git diff failed: {e.stderr.decode()}")


def main():
    """Main entry point."""
    cli()


if __name__ == "__main__":
    main()