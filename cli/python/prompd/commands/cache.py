"""Cache management commands for Prompd."""
from __future__ import annotations

from typing import Optional

import click

from prompd.commands.common import console


@click.group(name="cache")
def cache():
    """Package cache management commands."""
    pass


@cache.command("list")
@click.option("--global-only", is_flag=True, help="Show only global cache")
@click.option("--local-only", is_flag=True, help="Show only local cache")
def list_cache(global_only: bool, local_only: bool):
    """List cached packages."""
    try:
        from prompd.package_resolver import PackageResolver

        resolver = PackageResolver()

        if local_only:
            packages_dict = {"local": resolver.project_cache.list_packages(), "global": []}
        elif global_only:
            packages_dict = {"local": [], "global": resolver.global_cache.list_packages()}
        else:
            packages_dict = resolver.list_cached_packages()

        if packages_dict["local"]:
            console.print("\n[bold cyan]Local Project Cache (./.prompd/cache/):[/bold cyan]")
            for pkg in packages_dict["local"]:
                console.print(f"  {pkg.to_string()}")

        if packages_dict["global"]:
            console.print("\n[bold green]Global Cache (~/.cache/prompd/):[/bold green]")
            for pkg in packages_dict["global"]:
                console.print(f"  {pkg.to_string()}")

        if not packages_dict["local"] and not packages_dict["global"]:
            console.print("[yellow]No cached packages found[/yellow]")
    except Exception as exc:
        console.print(f"[red]Failed to list cache:[/red] {exc}")
        raise SystemExit(1)


@cache.command("clear")
@click.option("--global", "clear_global", is_flag=True, help="Clear global cache")
@click.option("--local", "clear_local", is_flag=True, help="Clear local cache")
@click.option("--all", "clear_all", is_flag=True, help="Clear both caches")
def clear_cache(clear_global: bool, clear_local: bool, clear_all: bool):
    """Clear package cache."""
    try:
        from prompd.package_resolver import PackageResolver

        resolver = PackageResolver()

        if clear_all:
            clear_global = clear_local = True
        elif not clear_global and not clear_local:
            clear_local = True

        resolver.clear_cache(clear_global=clear_global, clear_local=clear_local)

        cleared = []
        if clear_local:
            cleared.append("local")
        if clear_global:
            cleared.append("global")

        console.print(f"[green]Success:[/green] Cleared {' and '.join(cleared)} cache(s)")
    except Exception as exc:
        console.print(f"[red]Failed to clear cache:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["cache"]
