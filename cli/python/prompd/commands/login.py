"""Package registry login command."""
from __future__ import annotations

from typing import Optional

import click

from prompd.commands.common import console


@click.command(name="login")
@click.option("-k", "--api-key", help="API key for authentication")
@click.option("-u", "--username", help="Username for credential authentication")
@click.option("--password", help="Password for credential authentication")
@click.option("--registry", help="Registry to login to")
def login(api_key: Optional[str], username: Optional[str], password: Optional[str], registry: Optional[str]):
    """Login to package registry."""
    try:
        from prompd.registry import RegistryClient

        client = RegistryClient(registry_name=registry)

        if api_key:
            result = client.login_with_token(api_key)
        elif username and password:
            result = client.login_with_credentials(username, password)
        else:
            import getpass

            username = click.prompt("Username")
            password = getpass.getpass("Password: ")
            result = client.login_with_credentials(username, password)

        console.print(
            f"[green]Success:[/green] Logged in to {client.registry_name} as {result.get('username', 'user')}"
        )
    except Exception as exc:
        console.print(f"[red]Login failed:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["login"]
