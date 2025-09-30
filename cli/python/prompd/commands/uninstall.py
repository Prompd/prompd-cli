"""Uninstall command for Prompd packages."""
from __future__ import annotations

from pathlib import Path
from typing import Tuple

import click

from prompd.commands.common import console


@click.command(name="uninstall")
@click.argument("packages", nargs=-1, required=True)
@click.option("-g", "--global", "global_uninstall", is_flag=True, help="Uninstall packages globally")
@click.option("--save-dev", is_flag=True, help="Remove from development dependencies")
def uninstall(packages: Tuple[str, ...], global_uninstall: bool, save_dev: bool):
    """Uninstall packages."""
    try:
        from prompd.package_resolver import PackageResolver

        resolver = PackageResolver(global_mode=global_uninstall)

        for package_name in packages:
            console.print(f"Uninstalling {package_name}{' globally' if global_uninstall else ''}...")

            if global_uninstall:
                cached_packages = resolver.global_cache.list_packages()
                matching = [
                    p for p in cached_packages if p.name == package_name or f"@{p.namespace}/{p.name}" == package_name
                ]

                if not matching:
                    console.print(f"[yellow]Package {package_name} not found in global cache[/yellow]")
                    continue

                if len(matching) > 1:
                    console.print(f"[yellow]Multiple versions found. Please specify version:[/yellow]")
                    for pkg in matching:
                        console.print(f"  {pkg.to_string()}")
                    continue

                removed = resolver.uninstall_package(matching[0].to_string(), force_global=True)
            else:
                resolver.remove_dependency(package_name, dev=save_dev, global_uninstall=False)
                removed = True

            if removed:
                console.print(f"[green]OK[/green] Uninstalled {package_name}")
            else:
                console.print(f"[yellow]Package {package_name} not found[/yellow]")
    except Exception as exc:
        console.print(f"[red]Uninstall failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["uninstall"]
