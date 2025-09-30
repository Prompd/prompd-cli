"""Implementation of the `prompd validate` command."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import click

from prompd.commands.common import console


@click.command(name="validate")
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option("--verbose", "-v", is_flag=True, help="Show detailed validation results")
@click.option("--git", is_flag=True, help="Include git history consistency checks")
@click.option("--version-only", is_flag=True, help="Only validate version-related aspects")
@click.option("--check-overrides", is_flag=True, help="Validate section overrides against parent template")
def validate(
    file: Path,
    verbose: bool,
    git: bool,
    version_only: bool,
    check_overrides: bool,
):
    """Validate a .prmd file syntax and structure."""
    try:
        from prompd.validator import PrompdValidator

        validator = PrompdValidator()

        if version_only:
            issues = validator.validate_version_consistency(file, check_git=git)
        else:
            issues = validator.validate_file(file)
            if git:
                git_issues = validator.validate_version_consistency(file, check_git=True)
                issues.extend(git_issues)

        override_warnings = []
        if check_overrides:
            try:
                from prompd.parser import PrompdParser

                parser = PrompdParser()
                prompd = parser.parse_file(file)
                metadata = prompd.metadata

                if metadata and hasattr(metadata, "inherits") and metadata.inherits:
                    if hasattr(metadata, "override") and metadata.override:
                        parent_path = metadata.inherits
                        base_dir = file.parent

                        parent_file = (
                            base_dir / parent_path if not Path(parent_path).is_absolute() else Path(parent_path)
                        )

                        if parent_file.exists():
                            override_warnings = parser.validate_overrides_against_parent(file, parent_file)

                            if verbose and override_warnings:
                                console.print("\n[yellow]Override Validation Results:[/yellow]")
                                for warning in override_warnings:
                                    console.print(f"  [yellow]![/yellow] {warning}")

                            for warning in override_warnings:
                                issues.append({"level": "warning", "message": f"Override validation: {warning}"})
                        else:
                            issues.append({
                                "level": "error",
                                "message": f"Parent template not found: {parent_file}",
                            })
                    elif verbose:
                        console.print(
                            f"\n[blue]Override Check:[/blue] File inherits from {metadata.inherits} but has no overrides"
                        )
                elif verbose:
                    console.print("\n[blue]Override Check:[/blue] File does not use inheritance")

            except Exception as exc:
                issues.append({"level": "error", "message": f"Override validation failed: {exc}"})

        if not issues:
            console.print(f"[green]OK[/green] {file} is valid")
            return

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

        raise SystemExit(1 if errors else 0)
    except SystemExit:
        raise
    except Exception as exc:
        console.print(f"[red]Error validating file:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["validate"]
