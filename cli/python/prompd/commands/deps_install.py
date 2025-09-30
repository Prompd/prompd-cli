"""Install dependencies command for Prompd."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import click

from prompd.commands.common import console


@click.command(name="deps-install")
@click.argument("package")
@click.option("--save", is_flag=True, help="Save to dependencies")
@click.option("--save-dev", is_flag=True, help="Save to dev dependencies")
@click.option("--target", type=click.Path(), help="Installation directory")
@click.option("--parallel/--sequential", default=True, help="Parallel installation")
def install_dependencies(package: str, save: bool, save_dev: bool, target: Optional[str], parallel: bool):
    """Install package with all dependencies."""
    from prompd.dependency_resolver import DependencyResolver
    from prompd.package_resolver import PackageResolver, PackageReference

    try:
        resolver = DependencyResolver()

        with console.status(f"[bold green]Resolving dependencies for {package}..."):
            resolved = resolver.resolve(package, dev_dependencies=save_dev)

        console.print(f"[green]Resolved {len(resolved)} packages[/green]")

        target_dir = Path(target) if target else Path.cwd() / ".prompd" / "packages"

        with console.status(f"[bold green]Installing {len(resolved)} packages..."):
            installed = resolver.install_all(target_dir, parallel=parallel)

        console.print(f"[green]Successfully installed {len(installed)} packages to {target_dir}")

        lock_data = resolver.generate_lock_file()
        lock_file = Path.cwd() / ".prompd" / "lock.json"
        lock_file.parent.mkdir(parents=True, exist_ok=True)

        with open(lock_file, "w", encoding="utf-8") as lock:
            json.dump(lock_data, lock, indent=2)

        console.print(f"[green]Lock file saved to {lock_file}")

        if save or save_dev:
            resolver_inst = PackageResolver()
            config = resolver_inst.get_or_create_project_config()

            ref = PackageReference.parse(package)
            dep_name = ref.to_string().split("@")[0]

            if save:
                config.dependencies[dep_name] = ref.version
            elif save_dev:
                config.dev_dependencies[dep_name] = ref.version

            resolver_inst.save_project_config(config)
            console.print("[green]Updated project configuration[/green]")
    except Exception as exc:
        console.print(f"[red]Installation failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["install_dependencies"]
