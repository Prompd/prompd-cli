"""Install command for Prompd packages."""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional, Tuple

import click

from prompd.commands.common import console


@click.command(name="install")
@click.argument("packages", nargs=-1, required=False)
@click.option("-g", "--global", "global_install", is_flag=True, help="Install packages globally")
@click.option("--save", is_flag=True, default=True, help="Save to dependencies (default behavior)")
@click.option("--save-dev", is_flag=True, help="Save to development dependencies")
@click.option("--registry", help="Registry to install from")
def install(
    packages: Tuple[str, ...],
    global_install: bool,
    save: bool,
    save_dev: bool,
    registry: Optional[str],
):
    """Install packages from registry."""
    try:
        from prompd.package_resolver import PackageResolver

        dev = save_dev
        manifest_path = Path.cwd() / "manifest.json"

        if not packages:
            if not manifest_path.exists():
                console.print("[yellow]No manifest.json found and no packages specified[/yellow]")
                console.print("[dim]Run 'prompd install <package>' to create a new project[/dim]")
                return

            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)

            dependencies = manifest.get("dependencies", {})
            dev_dependencies = manifest.get("devDependencies", {})

            if not dependencies and not dev_dependencies:
                console.print("[yellow]No dependencies found in manifest.json[/yellow]")
                return

            resolver = PackageResolver(registry_urls=[registry] if registry else None, global_mode=global_install)

            all_packages = []
            for package_name, version in dependencies.items():
                package_ref = f"{package_name}@{version}" if version != "latest" else package_name
                all_packages.append((package_ref, False))

            for package_name, version in dev_dependencies.items():
                package_ref = f"{package_name}@{version}" if version != "latest" else package_name
                all_packages.append((package_ref, True))

            console.print(f"[bold]Installing {len(all_packages)} packages in parallel...[/bold]\n")

            def install_single_package(package_info):
                package_ref, is_dev = package_info
                try:
                    if global_install:
                        package_path = resolver.install_package(package_ref, force_global=True, save_to_lock=False)
                    else:
                        resolver.add_dependency(package_ref, dev=is_dev, global_install=False)
                        package_path = resolver.resolve_package(package_ref)
                    return (package_ref, is_dev, True, str(package_path))
                except Exception as exc:
                    return (package_ref, is_dev, False, str(exc))

            with ThreadPoolExecutor(max_workers=5) as executor:
                results = list(executor.map(install_single_package, all_packages))

            success_count = sum(1 for _, _, success, _ in results if success)
            for package_ref, is_dev, success, result in results:
                dev_tag = " (dev)" if is_dev else ""
                if success:
                    console.print(f"[green]OK[/green] {package_ref}{dev_tag}")
                else:
                    console.print(f"[red]FAILED[/red] {package_ref}{dev_tag}: {result}")

            console.print(f"\n[green]Successfully installed {success_count}/{len(all_packages)} packages[/green]")
            return

        if not manifest_path.exists():
            project_name = Path.cwd().name.lower().replace(" ", "-")
            manifest = {
                "name": project_name,
                "version": "1.0.0",
                "description": "",
                "dependencies": {},
                "devDependencies": {},
            }
            console.print(f"[green]Created manifest.json for {manifest['name']}[/green]")
        else:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            manifest.setdefault("dependencies", {})
            manifest.setdefault("devDependencies", {})

        resolver = PackageResolver(registry_urls=[registry] if registry else None, global_mode=global_install)

        if len(packages) > 1:
            console.print(f"[bold]Installing {len(packages)} packages in parallel...[/bold]\n")

            def install_single_package(package_ref: str):
                try:
                    if "@" in package_ref and not package_ref.startswith("@"):
                        package_name, package_version = package_ref.rsplit("@", 1)
                    else:
                        parts = package_ref.split("@")
                        if len(parts) == 3:
                            package_name = f"@{parts[1]}"
                            package_version = parts[2]
                        elif len(parts) == 2 and parts[0] == "":
                            package_name = package_ref
                            package_version = "latest"
                        else:
                            package_name = package_ref
                            package_version = "latest"

                    if global_install:
                        package_path = resolver.install_package(package_ref, force_global=True, save_to_lock=False)
                    else:
                        resolver.add_dependency(package_ref, dev=dev, global_install=False)
                        package_path = resolver.resolve_package(package_ref)

                        if dev:
                            manifest["devDependencies"][package_name] = package_version
                        else:
                            manifest["dependencies"][package_name] = package_version

                    return (package_ref, package_name, package_version, True, str(package_path))
                except Exception as exc:
                    return (package_ref, None, None, False, str(exc))

            with ThreadPoolExecutor(max_workers=5) as executor:
                results = list(executor.map(install_single_package, packages))

            success_count = sum(1 for _, _, _, success, _ in results if success)
            for package_ref, _, _, success, result in results:
                if success:
                    console.print(f"[green]OK[/green] {package_ref}")
                    console.print(f"  Location: {result}")
                else:
                    console.print(f"[red]FAILED[/red] {package_ref}: {result}")

            if success_count == len(packages):
                console.print(f"\n[green]All {len(packages)} packages installed successfully[/green]")
            else:
                console.print(f"\n[yellow]Installed {success_count}/{len(packages)} packages[/yellow]")
        else:
            package_ref = packages[0]
            console.print(f"Installing {package_ref} {'globally' if global_install else 'locally'}...")

            if "@" in package_ref and not package_ref.startswith("@"):
                package_name, package_version = package_ref.rsplit("@", 1)
            else:
                parts = package_ref.split("@")
                if len(parts) == 3:
                    package_name = f"@{parts[1]}"
                    package_version = parts[2]
                elif len(parts) == 2 and parts[0] == "":
                    package_name = package_ref
                    package_version = "latest"
                else:
                    package_name = package_ref
                    package_version = "latest"

            if global_install:
                package_path = resolver.install_package(package_ref, force_global=True, save_to_lock=False)
            else:
                resolver.add_dependency(package_ref, dev=dev, global_install=False)
                package_path = resolver.resolve_package(package_ref)

                if dev:
                    manifest["devDependencies"][package_name] = package_version
                else:
                    manifest["dependencies"][package_name] = package_version

            console.print(f"[green]OK[/green] Installed {package_ref}")
            console.print(f"  Location: {package_path}")

        if not global_install:
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, indent=2)
            console.print("\n[dim]Updated manifest.json and .prompd/lock.json[/dim]")
    except Exception as exc:
        console.print(f"[red]Installation failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["install"]
