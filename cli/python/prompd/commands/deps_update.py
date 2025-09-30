"""Update dependencies command for Prompd."""
from __future__ import annotations

from typing import List

import click

from prompd.commands.common import console


@click.command(name="deps-update")
@click.option("--dry-run", is_flag=True, help="Show what would be updated")
@click.option("--latest", is_flag=True, help="Update to latest versions")
def update_dependencies(dry_run: bool, latest: bool):
    """Update all dependencies to latest compatible versions."""
    from prompd.dependency_resolver import DependencyResolver, VersionConstraint
    from prompd.package_resolver import PackageResolver

    try:
        resolver_inst = PackageResolver()
        config = resolver_inst.get_or_create_project_config()

        if not config.dependencies:
            console.print("[yellow]No dependencies to update[/yellow]")
            return

        updates: List[dict] = []

        for dep_name, current_version in config.dependencies.items():
            try:
                package_info = (
                    resolver_inst.registries[resolver_inst.registry_urls[0]].get_package_info(dep_name)
                )
                available_versions = package_info.get("versions", {}).keys()

                if latest:
                    latest_version = max(available_versions)
                else:
                    constraint = VersionConstraint.parse(current_version)
                    compatible = [v for v in available_versions if constraint.matches(v)]
                    latest_version = max(compatible) if compatible else current_version

                if latest_version != current_version:
                    updates.append({"package": dep_name, "current": current_version, "new": latest_version})
            except Exception as exc:
                console.print(f"[yellow]Could not check {dep_name}: {exc}[/yellow]")

        if not updates:
            console.print("[green]All dependencies are up to date[/green]")
            return

        console.print("\n[bold]Available updates:[/bold]")
        for update in updates:
            console.print(f"  {update['package']}: {update['current']} -> {update['new']}")

        if not dry_run:
            for update in updates:
                config.dependencies[update["package"]] = update["new"]

            resolver_inst.save_project_config(config)
            console.print(f"\n[green]Updated {len(updates)} dependencies in config[/green]")
            console.print("[yellow]Run 'prompd deps-install' to install updated versions[/yellow]")
        else:
            console.print("\n[yellow]Dry run - no changes made[/yellow]")
    except Exception as exc:
        console.print(f"[red]Update check failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["update_dependencies"]
