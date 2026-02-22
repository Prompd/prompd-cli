"""Modular command structure for Prompd CLI."""

from .git_ops import git_group
from .package import package
from .provider import provider
from .registry import registry
from .version import version

__all__ = ["provider", "git_group", "version", "package", "registry"]
