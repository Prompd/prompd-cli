"""Chat-focused shell command for the Prompd CLI."""
from __future__ import annotations

import click

from prompd.commands.common import console


@click.command(name="chat")
def chat_command():
    """Start the Prompd shell directly in chat mode. [BETA FEATURE]"""
    try:
        from prompd.shell import PrompdShell

        shell = PrompdShell()
        shell.enter_chat_mode()
        shell.start()
    except Exception as exc:
        try:
            console.print(f"[red]Error launching chat:[/red] {exc}")
        except Exception:
            print(f"Error launching chat: {exc}")
        raise SystemExit(1)


__all__ = ["chat_command"]
