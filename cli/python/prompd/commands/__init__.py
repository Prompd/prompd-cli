"""Modular command structure for Prompd CLI."""

from .provider import provider
from .git_ops import git_group
from .version import version  
from .package import package
from .registry import registry

__all__ = ['provider', 'git_group', 'version', 'package', 'registry']