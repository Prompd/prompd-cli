"""
Streamlined shell module - imports from modular shell package.
This replaces the original 2,888-line shell.py with a clean modular structure.
"""

from .shell import InteractiveShell, start_prompd_shell

# Export the main interfaces for backward compatibility
__all__ = ['InteractiveShell', 'start_prompd_shell']