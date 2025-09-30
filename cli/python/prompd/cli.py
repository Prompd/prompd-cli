"""Command-line interface for Prompd."""
from __future__ import annotations

import click

from prompd import __version__ as PROMPD_VERSION

from prompd.commands.cache import cache
from prompd.commands.chat import chat_command
from prompd.commands.compile import compile_command
from prompd.commands.config import config
from prompd.commands.create import create_command
from prompd.commands.deps import dependencies
from prompd.commands.deps_install import install_dependencies
from prompd.commands.deps_update import update_dependencies
from prompd.commands.git import git
from prompd.commands.init import init
from prompd.commands.install import install
from prompd.commands.list_prompts import list_prompts
from prompd.commands.login import login
from prompd.commands.logout import logout
from prompd.commands.mcp import mcp
from prompd.commands.namespace import namespace, ns
from prompd.commands.package import package
from prompd.commands.pack import pack_alias
from prompd.commands.publish import publish
from prompd.commands.run import run
from prompd.commands.search import search
from prompd.commands.shell_cmd import shell_command
from prompd.commands.show import show
from prompd.commands.uninstall import uninstall
from prompd.commands.validate import validate
from prompd.commands.version_cmds import version
from prompd.commands.versions import versions
from prompd.commands.registry import registry


@click.group()
@click.version_option(version=PROMPD_VERSION, prog_name="prompd")
def cli():
    """Prompd - CLI for structured prompt definitions."""
    pass


# Register command groups
cli.add_command(config)
cli.add_command(mcp)
cli.add_command(git)
cli.add_command(version)
cli.add_command(namespace)
cli.add_command(ns)
cli.add_command(cache)
cli.add_command(registry)
cli.add_command(package)

# Register stand-alone commands
cli.add_command(run)
cli.add_command(validate)
cli.add_command(list_prompts)
cli.add_command(shell_command)
cli.add_command(chat_command)
cli.add_command(compile_command)
cli.add_command(show)
cli.add_command(login)
cli.add_command(logout)
cli.add_command(install)
cli.add_command(uninstall)
cli.add_command(search)
cli.add_command(publish)
cli.add_command(versions)
cli.add_command(dependencies)
cli.add_command(install_dependencies)
cli.add_command(update_dependencies)
cli.add_command(pack_alias)
cli.add_command(create_command)
cli.add_command(init)


__all__ = ["cli"]
