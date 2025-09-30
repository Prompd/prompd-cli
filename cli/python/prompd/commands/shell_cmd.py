"""Interactive shell command for the Prompd CLI."""
from __future__ import annotations

import click

from prompd.commands.common import console


@click.command(name="shell")
@click.option("--simple", is_flag=True, help="Use the simple REPL (no AI chat UI)")
def shell_command(simple: bool):
    """Start the interactive Prompd shell (REPL). [AI features in BETA]"""
    try:
        if simple:
            from prompd.interactive_simple import SimplePrompdREPL

            SimplePrompdREPL().start()
        else:
            from prompd.shell import PrompdShell

            PrompdShell().start()
    except Exception as exc:
        try:
            console.print(f"[red]Error launching shell:[/red] {exc}")
        except Exception:
            print(f"Error launching shell: {exc}")
        raise SystemExit(1)


__all__ = ["shell_command"]
