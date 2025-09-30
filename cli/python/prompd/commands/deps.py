"""Dependency analysis command for Prompd."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import click
from rich.panel import Panel

from prompd.commands.common import console


@click.command(name="deps")
@click.argument("package", required=False)
@click.option("--tree", is_flag=True, help="Show dependency tree")
@click.option("--conflicts", is_flag=True, help="Show version conflicts")
@click.option("--dev", is_flag=True, help="Include dev dependencies")
@click.option("--peer", is_flag=True, help="Include peer dependencies")
@click.option("--depth", default=3, help="Maximum tree depth to display")
def dependencies(package: Optional[str], tree: bool, conflicts: bool, dev: bool, peer: bool, depth: int):
    """Analyze package dependencies."""
    from prompd.dependency_resolver import DependencyResolver

    if not package:
        config_file = Path.cwd() / ".prompd" / "config.yaml"
        if config_file.exists():
            import yaml

            with open(config_file, "r", encoding="utf-8") as cfg:
                config = yaml.safe_load(cfg)
            package = f"{config.get('name', 'unknown')}@{config.get('version', 'latest')}"
        else:
            console.print("[red]No package specified and no .prompd/config.yaml found[/red]")
            raise SystemExit(1)

    try:
        resolver = DependencyResolver()

        with console.status(f"[bold green]Resolving dependencies for {package}..."):
            resolved = resolver.resolve(package, dev_dependencies=dev, peer_dependencies=peer)

        if tree:
            tree_str = resolver.get_dependency_tree()
            console.print(Panel(tree_str, title="Dependency Tree", border_style="green"))

        if conflicts:
            conflicts_list = resolver.find_conflicts()
            if conflicts_list:
                console.print("\n[bold red]Version Conflicts Found:[/bold red]")
                for conflict in conflicts_list:
                    console.print(f"\n  {conflict['package']}:")
                    console.print(f"    Resolved: {conflict['resolved_version']}")
                    for c in conflict["conflicts"]:
                        console.print(f"    - {c['requester']} requires {c['constraint']}")
            else:
                console.print("[green]No version conflicts found[/green]")

        if not tree and not conflicts:
            console.print(f"\n[bold]Dependencies for {package}:[/bold]")
            console.print(f"Total packages: {len(resolved)}")

            by_depth = {}
            for node in resolved.values():
                by_depth.setdefault(node.depth, []).append(node)

            for level in sorted(by_depth.keys())[:depth]:
                heading = "Root package" if level == 0 else f"Depth {level} dependencies"
                console.print(f"\n[bold]{heading}:[/bold]")

                for node in by_depth[level]:
                    console.print(f"  - {node.name}@{node.resolved_version}")
    except Exception as exc:
        console.print(f"[red]Dependency resolution failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["dependencies"]
