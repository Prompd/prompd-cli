"""Shared helpers used across CLI command modules."""
from __future__ import annotations

import re
from prompd.console import console

SEMVER_PATTERN = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def is_valid_semver(version: str) -> bool:
    """Return True if the provided version string matches semantic versioning."""
    return bool(SEMVER_PATTERN.match(version))


__all__ = ["console", "is_valid_semver"]
