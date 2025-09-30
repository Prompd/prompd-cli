"""Model Context Protocol (MCP) utilities."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import click

from prompd.commands.common import console


@click.group()
def mcp():
    """Model Context Protocol (MCP) utilities."""
    pass


@mcp.command("serve")
@click.argument("path", type=click.Path(exists=True, path_type=Path))
@click.option("--host", default="0.0.0.0", help="Bind host", show_default=True)
@click.option("--port", type=int, default=3333, help="Bind port", show_default=True)
@click.option("--oauth-client-id", default=None, help="OAuth client id")
@click.option("--auth-url", default=None, help="OAuth authorization URL")
@click.option("--token-url", default=None, help="OAuth token URL")
@click.option("--scopes", default=None, help="OAuth scopes (comma separated)")
def mcp_serve(
    path: Path,
    host: str,
    port: int,
    oauth_client_id: Optional[str],
    auth_url: Optional[str],
    token_url: Optional[str],
    scopes: Optional[str],
):
    """Serve a .prmd or .pdflow over HTTP with simple MCP-style endpoints."""
    try:
        try:
            from prompd.mcp_server import serve_app
        except Exception as imp_err:
            console.print("[red]FastAPI/uvicorn not installed.[/red] Install with: [cyan]pip install fastapi uvicorn[/cyan]")
            console.print(f"[dim]{imp_err}[/dim]")
            raise SystemExit(1)

        scope_list = [s.strip() for s in scopes.split(",")] if scopes else None
        serve_app(
            file_path=path,
            host=host,
            port=port,
            oauth={
                "client_id": oauth_client_id,
                "auth_url": auth_url,
                "token_url": token_url,
                "scopes": scope_list,
            },
        )
    except SystemExit:
        raise
    except Exception as exc:
        console.print(f"[red]Failed to start MCP server:[/red] {exc}")
        raise SystemExit(1)


@mcp.command("dockerize")
@click.option("--dockerfile", default="Dockerfile.prmd-mcp", help="Output Dockerfile name", show_default=True)
@click.option("--compose", default="docker-compose.prmd-mcp.yml", help="Output docker-compose file name", show_default=True)
@click.option("--port", type=int, default=3333, help="Container port to expose", show_default=True)
def mcp_dockerize(dockerfile: str, compose: str, port: int):
    """Scaffold Docker + Compose files to serve a .prmd/.pdflow via MCP."""
    try:
        from textwrap import dedent

        dockerfile_content = dedent(
            f"""
        # Prompd MCP server image
        FROM python:3.11-slim
        WORKDIR /app
        # Install Prompd with MCP extras from PyPI (requires published package)
        RUN pip install --no-cache-dir "prompd[mcp]"
        # Default env; override at runtime
        ENV PROMPD_DEFAULT_PROVIDER=openai \\
            PROMPD_DEFAULT_MODEL=gpt-3.5-turbo
        EXPOSE {port}
        # Serve any mounted file under /data; override the path with docker run args or compose command
        CMD ["prompd", "mcp", "serve", "/data/prompt.prmd", "--host", "0.0.0.0", "--port", "{port}"]
        """
        )

        compose_content = dedent(
            f"""
        version: "3.9"
        services:
          prompd-mcp:
            build:
              context: .
              dockerfile: {dockerfile}
            environment:
              - OPENAI_API_KEY=${{OPENAI_API_KEY}}
              - ANTHROPIC_API_KEY=${{ANTHROPIC_API_KEY}}
              - PROMPD_DEFAULT_PROVIDER=${{PROMPD_DEFAULT_PROVIDER:-openai}}
              - PROMPD_DEFAULT_MODEL=${{PROMPD_DEFAULT_MODEL:-gpt-3.5-turbo}}
            volumes:
              - ./prompds:/data
            ports:
              - "{port}:{port}"
        """
        )

        Path(dockerfile).write_text(dockerfile_content.strip() + "\n", encoding="utf-8")
        Path(compose).write_text(compose_content.strip() + "\n", encoding="utf-8")

        console.print(f"[green]OK[/green] Wrote {dockerfile} and {compose}")
    except Exception as exc:
        console.print(f"[red]Failed to scaffold Docker files:[/red] {exc}")
        raise SystemExit(1)


__all__ = ["mcp"]
