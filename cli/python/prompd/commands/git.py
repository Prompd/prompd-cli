"""Git-related commands for the Prompd CLI."""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional, Tuple

import click

from prompd.commands.common import console, is_valid_semver
from prompd.security import SecurityError, validate_git_file_path, validate_git_message


@click.group(name="git")
def git():
    """Git operations for .prmd files."""
    pass


@git.command("add")
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True, path_type=Path))
@click.option("--verbose", "-v", is_flag=True, help="Show git output")
def git_add(files: Tuple[Path, ...], verbose: bool):
    """Add .prmd files to git staging area."""
    try:
        for file_path in files:
            file_path = Path(file_path)
            if file_path.suffix != ".prmd":
                console.print(f"[yellow]Skipping non-.prmd file:[/yellow] {file_path}")
                continue

            result = subprocess.run(["git", "add", str(file_path)], capture_output=True, text=True, check=True)

            console.print(f"[green]OK[/green] Added {file_path}")
            if verbose and result.stdout:
                console.print(f"[dim]{result.stdout}[/dim]")
    except subprocess.CalledProcessError as exc:
        console.print(f"[red]Error adding files:[/red] {exc.stderr}")
        raise SystemExit(1)


@git.command("remove")
@click.argument("files", nargs=-1, required=True, type=click.Path(exists=True, path_type=Path))
@click.option("--cached", is_flag=True, help="Only remove from index, keep in working directory")
@click.option("--verbose", "-v", is_flag=True, help="Show git output")
def git_remove(files: Tuple[Path, ...], cached: bool, verbose: bool):
    """Remove .prmd files from git tracking."""
    try:
        for file_path in files:
            file_path = Path(file_path)
            if file_path.suffix != ".prmd":
                console.print(f"[yellow]Skipping non-.prmd file:[/yellow] {file_path}")
                continue

            cmd = ["git", "rm"]
            if cached:
                cmd.append("--cached")
            cmd.append(str(file_path))

            result = subprocess.run(cmd, capture_output=True, text=True, check=True)

            action = "Removed from index" if cached else "Removed"
            console.print(f"[green]OK[/green] {action}: {file_path}")
            if verbose and result.stdout:
                console.print(f"[dim]{result.stdout}[/dim]")
    except subprocess.CalledProcessError as exc:
        console.print(f"[red]Error removing files:[/red] {exc.stderr}")
        raise SystemExit(1)


@git.command("status")
@click.option("--path", "-p", type=click.Path(exists=True, path_type=Path), help="Check status for specific path")
def git_status(path: Optional[Path]):
    """Show git status for .prmd files."""
    try:
        cmd = ["git", "status", "--short"]
        if path:
            cmd.append(str(path))

        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not result.stdout:
            console.print("[green]No changes to .prmd files[/green]")
            return

        prompd_changes = [line for line in result.stdout.strip().split("\n") if ".prmd" in line]

        if prompd_changes:
            console.print("[bold]Git status for .prmd files:[/bold]")
            for change in prompd_changes:
                status_code = change[:2]
                file_path = change[3:]

                if "M" in status_code:
                    status_color = "yellow"
                    status_text = "Modified"
                elif "A" in status_code:
                    status_color = "green"
                    status_text = "Added"
                elif "D" in status_code:
                    status_color = "red"
                    status_text = "Deleted"
                elif "?" in status_code:
                    status_color = "blue"
                    status_text = "Untracked"
                else:
                    status_color = "white"
                    status_text = status_code

                console.print(f"  [{status_color}]{status_text:10}[/{status_color}] {file_path}")
        else:
            console.print("[dim]No .prmd file changes[/dim]")
    except subprocess.CalledProcessError as exc:
        console.print(f"[red]Error checking status:[/red] {exc.stderr}")
        raise SystemExit(1)


@git.command("commit")
@click.option("--message", "-m", required=True, help="Commit message")
@click.option("--all", "-a", is_flag=True, help="Automatically stage all modified .prmd files")
def git_commit(message: str, all: bool):
    """Commit staged .prmd files."""
    try:
        if all:
            result = subprocess.run(
                ["git", "status", "--porcelain"],
                capture_output=True,
                text=True,
                check=True,
            )

            for line in result.stdout.strip().split("\n"):
                if line and ".prmd" in line and line[0] == " " and line[1] == "M":
                    file_path = line[3:]
                    try:
                        safe_path = validate_git_file_path(file_path)
                        subprocess.run(["git", "add", safe_path], check=True)
                        console.print(f"[dim]Auto-staging: {safe_path}[/dim]")
                    except SecurityError as exc:
                        console.print(f"[red]Security warning: Skipping unsafe file path: {exc}[/red]")
                        continue

        try:
            safe_message = validate_git_message(message)
        except SecurityError as exc:
            console.print(f"[red]Error: Invalid commit message: {exc}[/red]")
            raise click.Abort()

        result = subprocess.run(
            ["git", "commit", "-m", safe_message],
            capture_output=True,
            text=True,
            check=True,
        )

        console.print(f"[green]OK[/green] Committed changes")
        if result.stdout:
            for line in result.stdout.strip().split("\n"):
                if "file" in line and "changed" in line:
                    console.print(f"[dim]{line}[/dim]")
    except subprocess.CalledProcessError as exc:
        if exc.stdout and "nothing to commit" in exc.stdout:
            console.print("[yellow]Nothing to commit[/yellow]")
        else:
            console.print(f"[red]Error committing:[/red] {exc.stderr}")
        raise SystemExit(1)


@git.command("checkout")
@click.argument("file", type=click.Path(path_type=Path))
@click.argument("version")
@click.option("--output", "-o", type=click.Path(), help="Output to different file instead of overwriting")
def git_checkout(file: Path, version: str, output: Optional[str]):
    """Checkout a specific version of a .prmd file."""
    try:
        if file.suffix != ".prmd":
            console.print(f"[red]Error:[/red] {file} is not a .prmd file")
            raise SystemExit(1)

        if is_valid_semver(version):
            tag_name = f"{file.stem}-v{version}"
            tag_check = subprocess.run(["git", "tag", "-l", tag_name], capture_output=True, text=True)
            version_ref = tag_name if tag_check.stdout.strip() else version
        else:
            version_ref = version

        git_path = str(file).replace("\\", "/")
        result = subprocess.run(
            ["git", "show", f"{version_ref}:{git_path}"],
            capture_output=True,
            text=True,
            check=True,
        )

        content = result.stdout

        if output:
            output_path = Path(output)
            output_path.write_text(content, encoding="utf-8")
            console.print(f"[green]OK[/green] Checked out {file} @ {version} to {output_path}")
        else:
            file.write_text(content, encoding="utf-8")
            console.print(f"[green]OK[/green] Checked out {file} @ {version}")
            console.print("[yellow]Note:[/yellow] Working directory has been modified. Use 'git diff' to see changes.")
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr or ""
        if "does not exist" in stderr:
            console.print(f"[red]Error:[/red] Version '{version}' not found for {file}")
            console.print("[dim]Try 'prompd version history' to see available versions[/dim]")
        else:
            console.print(f"[red]Error checking out version:[/red] {stderr}")
        raise SystemExit(1)


__all__ = ["git"]
