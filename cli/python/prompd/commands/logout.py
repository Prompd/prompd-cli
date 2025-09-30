"""Package registry logout command."""
from __future__ import annotations

from typing import Optional

import click

from prompd.commands.common import console


@click.command(name="logout")
@click.option("--registry", help="Registry to logout from")
def logout(registry: Optional[str]):
    """Logout from package registry."""
    try:
        from prompd.registry import RegistryClient

        client = RegistryClient(registry_name=registry)
        client.logout()

        console.print(f"[green]Success:[/green] Logged out from {client.registry_name}")
    except Exception as exc:
        console.print(f"[red]Logout failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["logout"]
