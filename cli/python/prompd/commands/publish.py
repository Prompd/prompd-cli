"""Publish command for Prompd packages."""
from __future__ import annotations

import json
import zipfile
from pathlib import Path
from typing import Optional

import click

from prompd.commands.common import console


@click.command(name="publish")
@click.argument("package_file", type=click.Path(exists=True, path_type=Path))
@click.option("--registry", help="Registry to publish to")
@click.option("-ns", "--namespace", help="Namespace to publish to (overrides current namespace context)")
@click.option("-n", "--dry-run", is_flag=True, help="Show what would be published without actually doing it")
def publish(package_file: Path, registry: Optional[str], namespace: Optional[str], dry_run: bool):
    """Publish package to registry."""
    try:
        if dry_run:
            console.print(f"[yellow]DRY RUN: Would publish {package_file}[/yellow]")
            return

        package_name = "unknown"
        package_version = "unknown"
        try:
            with zipfile.ZipFile(package_file, "r") as zf:
                if "manifest.json" in zf.namelist():
                    manifest_bytes = zf.read("manifest.json")
                    manifest_text = manifest_bytes.decode("utf-8", errors="replace")
                    manifest_data = json.loads(manifest_text)
                    package_name = manifest_data.get("id", manifest_data.get("name", "unknown"))
                    package_version = manifest_data.get("version", "unknown")

                    if namespace and not package_name.startswith("@"):
                        package_name = f"{namespace}/{package_name}"
        except Exception:
            pass

        console.print(f"[blue]Publishing {package_name}@{package_version}...[/blue]")
        console.print(f"[dim]Package: {package_file}[/dim]")

        from prompd.registry import RegistryClient

        client = RegistryClient(registry_name=registry)

        current_ns = client.get_current_namespace()
        if namespace:
            console.print(f"[dim]Namespace: {namespace} (override)[/dim]")
        elif current_ns:
            console.print(f"[dim]Namespace: {current_ns} (current)[/dim]")
        else:
            console.print(f"[dim]Namespace: none (will use package scope or registry default)[/dim]")

        file_size = package_file.stat().st_size
        console.print(f"[dim]Size: {file_size:,} bytes[/dim]")
        console.print("[yellow]Uploading...[/yellow]")

        if namespace:
            result = client.publish_package(package_file, target_namespace=namespace)
        else:
            result = client.publish_package(package_file)

        published_name = result.get("package", {}).get("fullName") or result.get("name") or package_name
        published_version = result.get("package", {}).get("version") or result.get("version") or package_version

        console.print(f"[green]SUCCESS[/green] Published {published_name}@{published_version}")
        console.print(f"  Registry: {client.registry_name}")
        if "package_url" in result:
            console.print(f"  URL: {result['package_url']}")
        elif "url" in result:
            console.print(f"  URL: {result['url']}")
    except Exception as exc:
        console.print(f"[red]Publish failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["publish"]
