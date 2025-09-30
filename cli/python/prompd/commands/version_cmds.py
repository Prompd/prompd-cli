"""Version management commands for Prompd."""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Dict, List, Optional

import click
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from prompd.commands.common import console, is_valid_semver


@click.group(name="version")
def version():
    """Version management commands."""
    pass


@version.command("bump")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.argument("bump_type", type=click.Choice(["major", "minor", "patch"]))
@click.option("--message", "-m", help="Commit message")
@click.option("--dry-run", is_flag=True, help="Show what would be done without making changes")
def version_bump(file: Path, bump_type: str, message: Optional[str], dry_run: bool):
    """Bump version in a .prmd file and create git tag."""
    try:
        from prompd.parser import PrompdParser

        parser = PrompdParser()
        prompd = parser.parse_file(file)

        current_version = prompd.metadata.version or "0.0.0"
        new_version = _bump_version(current_version, bump_type)

        if dry_run:
            console.print(f"[dim]Would bump {file} from {current_version} to {new_version}[/dim]")
            return

        _update_version_in_file(file, new_version)

        commit_msg = message or f"Bump {file.name} to {new_version}"
        _git_commit_and_tag(file, new_version, commit_msg)

        console.print(f"[green]OK[/green] Bumped {file.name} from {current_version} to {new_version}")
    except Exception as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise SystemExit(1)


@version.command("history")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--limit", "-n", type=int, default=10, help="Number of versions to show")
def version_history(file: Path, limit: int):
    """Show version history for a .prmd file."""
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
            table.add_row(tag_info["tag"], tag_info["date"], tag_info["commit"][:8], tag_info["message"][:60])

        console.print(table)
    except Exception as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise SystemExit(1)


@version.command("diff")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.argument("version1")
@click.argument("version2", required=False)
def version_diff(file: Path, version1: str, version2: Optional[str]):
    """Show differences between versions of a .prmd file."""
    try:
        version2 = version2 or "HEAD"
        diff_output = _git_diff_versions(file, version1, version2)

        if not diff_output:
            console.print(f"[green]No differences between {version1} and {version2}[/green]")
            return

        syntax = Syntax(diff_output, "diff", theme="monokai", line_numbers=True)
        console.print(Panel(syntax, title=f"Diff: {version1} -> {version2}"))
    except Exception as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise SystemExit(1)


@version.command("validate")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--git", is_flag=True, help="Validate against git history")
def version_validate(file: Path, git: bool):
    """Validate version consistency."""
    try:
        from prompd.parser import PrompdParser

        parser = PrompdParser()
        prompd = parser.parse_file(file)

        current_version = prompd.metadata.version
        if not current_version:
            console.print(f"[yellow]WARNING[/yellow] No version specified in {file}")
            return

        if not is_valid_semver(current_version):
            console.print(f"[red]ERROR[/red] Invalid semantic version: {current_version}")
            raise SystemExit(1)

        if git:
            latest_tag = _get_latest_git_tag(file)
            if latest_tag and latest_tag != current_version:
                console.print(f"[yellow]WARNING[/yellow] Version mismatch:")
                console.print(f"  File version: {current_version}")
                console.print(f"  Latest git tag: {latest_tag}")

        console.print(f"[green]OK[/green] Version {current_version} is valid")
    except SystemExit:
        raise
    except Exception as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise SystemExit(1)


@version.command("suggest")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--changes", help="Description of changes made")
def version_suggest(file: Path, changes: Optional[str]):
    """Suggest appropriate version bump based on changes."""
    try:
        from prompd.parser import PrompdParser
        from prompd.validator import PrompdValidator

        parser = PrompdParser()
        validator = PrompdValidator()
        prompd = parser.parse_file(file)

        current_version = prompd.metadata.version or "0.0.0"
        suggestion = validator.suggest_version_bump(current_version, changes or "")

        console.print(
            Panel(
                f"[bold cyan]Current Version:[/bold cyan] {suggestion['suggestions']['current']}\n\n"
                f"[bold green]Suggested Bump:[/bold green] {suggestion['recommended']} -> "
                f"{suggestion['suggestions'][suggestion['recommended']]}\n\n"
                f"[bold]All Options:[/bold]\n"
                f"  - Patch: {suggestion['suggestions']['patch']} (bug fixes)\n"
                f"  - Minor: {suggestion['suggestions']['minor']} (new features)\n"
                f"  - Major: {suggestion['suggestions']['major']} (breaking changes)\n\n"
                f"[dim]{suggestion['reason']}[/dim]",
                title="Version Bump Suggestions",
            )
        )
    except Exception as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise SystemExit(1)


def _bump_version(version: str, bump_type: str) -> str:
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


def _update_version_in_file(file_path: Path, new_version: str):
    content = file_path.read_text(encoding="utf-8")

    import re

    if content.startswith("---\n"):
        end_match = re.search(r"\n---\n", content[4:])
        if end_match:
            yaml_end = end_match.end() + 4
            frontmatter = content[4 : yaml_end - 5]
            markdown_content = content[yaml_end:]

            import yaml

            metadata = yaml.safe_load(frontmatter) or {}
            metadata["version"] = new_version
            updated_content = f"---\n{yaml.dump(metadata, default_flow_style=False)}---\n{markdown_content}"
            file_path.write_text(updated_content, encoding="utf-8")


def _git_commit_and_tag(file_path: Path, version: str, message: str):
    try:
        from prompd.security import SecurityError, validate_git_file_path, validate_git_message, validate_version_string

        safe_path = validate_git_file_path(str(file_path))
        safe_message = validate_git_message(message)
        safe_version = validate_version_string(version)

        subprocess.run(["git", "add", safe_path], check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", safe_message], check=True, capture_output=True)

        safe_stem = validate_git_file_path(file_path.stem)
        tag_name = f"{safe_stem}-v{safe_version}"
        subprocess.run(["git", "tag", tag_name], check=True, capture_output=True)
    except SecurityError as exc:
        raise Exception(f"Security validation failed: {exc}") from exc
    except subprocess.CalledProcessError as exc:
        raise Exception(f"Git operation failed: {exc.stderr.decode() if exc.stderr else exc}") from exc


def _get_git_tags(file_path: Path, limit: int) -> List[Dict[str, str]]:
    try:
        result = subprocess.run(
            [
                "git",
                "log",
                "--tags",
                "--simplify-by-decoration",
                "--pretty=format:%d|%H|%ai|%s",
                "-n",
                str(limit),
                "--",
                str(file_path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )

        tags: List[Dict[str, str]] = []
        for line in result.stdout.split("\n"):
            if line.strip():
                parts = line.split("|", 3)
                if len(parts) == 4 and "tag:" in parts[0]:
                    import re

                    tag_match = re.search(r"tag: ([^,)]+)", parts[0])
                    if tag_match:
                        tags.append(
                            {
                                "tag": tag_match.group(1).strip(),
                                "commit": parts[1],
                                "date": parts[2][:10],
                                "message": parts[3],
                            }
                        )
        return tags
    except subprocess.CalledProcessError:
        return []


def _get_latest_git_tag(file_path: Path) -> Optional[str]:
    tags = _get_git_tags(file_path, 1)
    return tags[0]["tag"] if tags else None


def _git_diff_versions(file_path: Path, version1: str, version2: str) -> str:
    try:
        result = subprocess.run(
            [
                "git",
                "diff",
                f"{file_path.stem}-v{version1}",
                f"{file_path.stem}-v{version2}",
                "--",
                str(file_path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout
    except subprocess.CalledProcessError as exc:
        raise Exception(f"Git diff failed: {exc.stderr.decode() if exc.stderr else exc}") from exc


__all__ = ["version"]
