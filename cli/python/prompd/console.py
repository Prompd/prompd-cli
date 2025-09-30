"""Shared Rich console configuration for the Prompd CLI."""
from __future__ import annotations

import platform
import sys
from rich.console import Console


def _create_console() -> Console:
    """Create a Rich console with consistent settings across commands."""
    try:
        if platform.system() == "Windows":
            # Force UTF-8 with Rich's legacy Windows handling to avoid encoding glitches
            return Console(file=sys.stdout, legacy_windows=True, width=120, force_terminal=True)
        return Console(file=sys.stdout, force_terminal=True, width=120)
    except Exception:
        # Fallback configuration if Rich cannot initialise with preferred settings
        return Console(file=sys.stdout, legacy_windows=True, width=120)


console: Console = _create_console()

__all__ = ["console"]
