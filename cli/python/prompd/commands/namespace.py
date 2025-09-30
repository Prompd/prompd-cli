"""Namespace management commands for Prompd."""
from __future__ import annotations

from typing import Optional

import click
from rich.panel import Panel
from rich.table import Table

from prompd.commands.common import console


@click.group(name="namespace")
def namespace():
    """Manage namespaces for organizations."""
    pass


@click.group(name="ns")
def ns():
    """Alias for namespace commands."""
    pass


@namespace.command("list")
@click.option("--registry", help="Registry to query")
@click.option(
    "--show-permissions", "-p", is_flag=True, help="Show detailed permissions for each namespace"
)
def namespace_list(registry: Optional[str], show_permissions: bool):
    """List accessible namespaces."""
    try:
        from prompd.registry import RegistryClient

        client = RegistryClient(registry_name=registry)
        namespaces = client.list_user_namespaces()

        if not namespaces:
            console.print("[yellow]No namespaces available[/yellow]")
            console.print("\nTo get started:")
            console.print("-Free users can publish to @public automatically")
            console.print("-Create a team namespace: [cyan]prompd namespace create @my-company[/cyan]")
            return

        current_ns = client.get_current_namespace()

        console.print(f"[bold]Available namespaces ({len(namespaces)} total):[/bold]")

        table = Table(show_header=True, header_style="bold magenta")
        table.add_column("NAMESPACE", style="cyan")
        table.add_column("PACKAGES", justify="right")
        table.add_column("DOWNLOADS", justify="right")
        table.add_column("ROLE", style="green")
        if show_permissions:
            table.add_column("PERMISSIONS", style="dim")
        table.add_column("STATUS", justify="center")

        for ns_info in namespaces:
            status = "[bold green]CURRENT[/bold green]" if ns_info["name"] == current_ns else ""
            if ns_info.get("verified"):
                status += " [OK]" if status else "[OK]"

            permissions_str = ""
            if show_permissions:
                perms = ns_info.get("permissions", {})
                perm_list = []
                if perms.get("canPublish"):
                    perm_list.append("publish")
                if perms.get("canManage"):
                    perm_list.append("manage")
                if perms.get("canInvite"):
                    perm_list.append("invite")
                if perms.get("canDelete"):
                    perm_list.append("delete")
                permissions_str = ", ".join(perm_list) or "read"

            row = [
                ns_info["name"],
                str(ns_info.get("packageCount", 0)),
                str(ns_info.get("downloadCount", 0)),
                ns_info.get("role", "read").upper(),
            ]
            if show_permissions:
                row.append(permissions_str)
            row.append(status)

            table.add_row(*row)

        console.print(table)

        if current_ns:
            console.print(f"\n[dim]Current namespace context: [cyan]{current_ns}[/cyan][/dim]")
        else:
            console.print("\n[dim]No current namespace context set[/dim]")

        console.print("\n[dim]Switch namespace: [cyan]prompd ns use <namespace>[/cyan][/dim]")
    except Exception as exc:
        console.print(f"[red]Failed to list namespaces:[/red] {exc}")
        raise SystemExit(1)


@namespace.command("current")
@click.option("--registry", help="Registry to query")
def namespace_current(registry: Optional[str]):
    """Show current namespace context."""
    try:
        from prompd.registry import RegistryClient

        client = RegistryClient(registry_name=registry)
        current_ns = client.get_current_namespace()

        if current_ns:
            details = client.get_namespace_details(current_ns)
            console.print(f"[bold]Current namespace:[/bold] [cyan]{current_ns}[/cyan]")

            if details:
                console.print(f"  Description: {details.get('description', 'No description')}")
                console.print(f"  Packages: {details.get('packageCount', 0)}")
                console.print(f"  Downloads: {details.get('downloadCount', 0)}")
                console.print(f"  Role: {details.get('role', 'unknown').upper()}")
                if details.get("verified"):
                    console.print("  Status: [green]Verified [OK][/green]")
        else:
            console.print("[yellow]No current namespace context set[/yellow]")
            console.print("\nSet a namespace context:")
            console.print("  [cyan]prompd ns use @public[/cyan]     # Use public namespace")
            console.print("  [cyan]prompd ns use @my-company[/cyan] # Use your team namespace")
    except Exception as exc:
        console.print(f"[red]Failed to get current namespace:[/red] {exc}")
        raise SystemExit(1)


@namespace.command("use")
@click.argument("namespace_name", required=True)
@click.option("--registry", help="Registry to use")
def namespace_use(namespace_name: str, registry: Optional[str]):
    """Switch to a different namespace context."""
    try:
        from prompd.registry import RegistryClient

        if not namespace_name.startswith("@"):
            namespace_name = "@" + namespace_name

        client = RegistryClient(registry_name=registry)
        client.set_current_namespace(namespace_name)

        console.print(f"[green]Success:[/green] Switched to namespace [cyan]{namespace_name}[/cyan]")
        console.print("\n[dim]Future publishes will use this namespace unless overridden with the -ns flag[/dim]")
    except Exception as exc:
        console.print(f"[red]Failed to switch namespace:[/red] {exc}")
        raise SystemExit(1)


@namespace.command("create")
@click.argument("namespace_name", required=True)
@click.option("--description", "-d", help="Description for the namespace")
@click.option("--organization", "-o", help="Organization ID to create namespace under")
@click.option(
    "--visibility",
    type=click.Choice(["public", "private"]),
    default="public",
    help="Namespace visibility",
)
@click.option("--registry", help="Registry to create namespace in")
def namespace_create(
    namespace_name: str,
    description: Optional[str],
    organization: Optional[str],
    visibility: str,
    registry: Optional[str],
):
    """Create a new namespace."""
    try:
        from prompd.registry import RegistryClient

        if not namespace_name.startswith("@"):
            namespace_name = "@" + namespace_name

        client = RegistryClient(registry_name=registry)

        namespace_data = {"name": namespace_name, "visibility": visibility}
        if description:
            namespace_data["description"] = description
        if organization:
            namespace_data["organizationId"] = organization

        console.print(f"[bold]Creating namespace:[/bold] [cyan]{namespace_name}[/cyan]")

        result = client.create_namespace(namespace_data)

        if result.get("requiresVerification"):
            console.print(f"[yellow]Namespace requires verification[/yellow]")
            console.print(f"Reason: {result.get('reason')}")
            console.print(f"Request ID: {result.get('requestId')}")
            console.print("\nCheck verification status: [cyan]prompd ns verify-status @namespace[/cyan]")
        else:
            console.print(f"[green]Success:[/green] Namespace [cyan]{namespace_name}[/cyan] created successfully")
            client.set_current_namespace(namespace_name)
            console.print("[dim]Automatically switched to namespace context[/dim]")
    except Exception as exc:
        console.print(f"[red]Failed to create namespace:[/red] {exc}")
        raise SystemExit(1)


# Alias commands delegate to namespace implementations

@ns.command("list")
@click.option("--registry", help="Registry to query")
@click.option(
    "--show-permissions", "-p", is_flag=True, help="Show detailed permissions for each namespace"
)
def ns_list(registry: Optional[str], show_permissions: bool):
    namespace_list(registry, show_permissions)


@ns.command("current")
@click.option("--registry", help="Registry to query")
def ns_current(registry: Optional[str]):
    namespace_current(registry)


@ns.command("use")
@click.argument("namespace_name", required=True)
@click.option("--registry", help="Registry to use")
def ns_use(namespace_name: str, registry: Optional[str]):
    namespace_use(namespace_name, registry)


@ns.command("create")
@click.argument("namespace_name", required=True)
@click.option("--description", "-d", help="Description for the namespace")
@click.option("--organization", "-o", help="Organization ID to create namespace under")
@click.option(
    "--visibility",
    type=click.Choice(["public", "private"]),
    default="public",
    help="Namespace visibility",
)
@click.option("--registry", help="Registry to create namespace in")
def ns_create(
    namespace_name: str,
    description: Optional[str],
    organization: Optional[str],
    visibility: str,
    registry: Optional[str],
):
    namespace_create(namespace_name, description, organization, visibility, registry)


__all__ = ["namespace", "ns"]
