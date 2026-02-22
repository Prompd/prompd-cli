"""
Custom Jinja2 Loader for Prompd Files

This loader enables {% include %} directives in .prmd files with compile-aware behavior:
- .prmd files: Parses and returns only the body content (frontmatter stripped)
- Other files (.md, .txt, etc.): Returns raw content as-is

Features:
- Workspace-aware path resolution (relative to source file)
- Circular include detection
- Compile-on-demand for .prmd files
"""

import threading
from pathlib import Path
from typing import Dict, Optional, Set, Tuple

from jinja2 import BaseLoader, TemplateNotFound

# Global include stack for circular dependency detection
# Keyed by compilation ID to support concurrent compilations
_global_include_stacks: Dict[str, Set[str]] = {}
_stack_lock = threading.Lock()
_compilation_counter = 0


def generate_compilation_id() -> str:
    """Generate a unique compilation ID."""
    global _compilation_counter
    with _stack_lock:
        _compilation_counter += 1
        import time

        return f"compile-{_compilation_counter}-{int(time.time() * 1000)}"


def cleanup_compilation(compilation_id: str) -> None:
    """Clean up the global stack after compilation is complete."""
    with _stack_lock:
        _global_include_stacks.pop(compilation_id, None)


class PrompdLoader(BaseLoader):
    """
    Custom Jinja2 loader that handles .prmd files specially.

    When a .prmd file is included, this loader:
    1. Parses the frontmatter
    2. Extracts only the body content
    3. Returns the body for inclusion

    This allows prompts to be composed from other prompts without
    duplicating frontmatter or metadata.
    """

    def __init__(
        self, base_dir: Path, verbose: bool = False, max_depth: int = 10, compilation_id: Optional[str] = None
    ):
        """
        Initialize the Prompd loader.

        Args:
            base_dir: Base directory for resolving relative paths
            verbose: Enable verbose logging
            max_depth: Maximum include depth to prevent infinite recursion
            compilation_id: Unique compilation ID for tracking include stack
        """
        self.base_dir = Path(base_dir)
        self.verbose = verbose
        self.max_depth = max_depth

        # Use provided compilation ID or generate a new one
        self.compilation_id = compilation_id or generate_compilation_id()

        # Initialize global stack for this compilation if needed
        with _stack_lock:
            if self.compilation_id not in _global_include_stacks:
                _global_include_stacks[self.compilation_id] = set()

    def _get_include_stack(self) -> Set[str]:
        """Get the include stack for this compilation."""
        with _stack_lock:
            return _global_include_stacks.get(self.compilation_id, set())

    def _add_to_stack(self, path: str) -> None:
        """Add a path to the include stack."""
        with _stack_lock:
            if self.compilation_id in _global_include_stacks:
                _global_include_stacks[self.compilation_id].add(path)

    def get_source(self, environment, template: str) -> Tuple[str, str, callable]:
        """
        Get the source content for a template.
        This is the main entry point called by Jinja2.

        Args:
            environment: Jinja2 environment
            template: Template name/path

        Returns:
            Tuple of (source, filename, uptodate_func)

        Raises:
            TemplateNotFound: If template cannot be found
        """
        # Resolve path relative to base directory
        resolved_path = self._resolve_path(template)
        include_stack = self._get_include_stack()

        if self.verbose:
            print(f"[include] Resolving: {template} -> {resolved_path}")

        # Check for circular includes
        if str(resolved_path) in include_stack:
            stack = " -> ".join(sorted(include_stack))
            raise TemplateNotFound(f"Circular include detected: {stack} -> {resolved_path}")

        # Check max depth
        if len(include_stack) >= self.max_depth:
            raise TemplateNotFound(
                f"Maximum include depth ({self.max_depth}) exceeded. " "Check for deep nesting or circular includes."
            )

        # Check if file exists
        if not resolved_path.exists():
            # Try with .prmd extension if not specified
            if not str(resolved_path).endswith(".prmd"):
                with_ext = resolved_path.parent / (resolved_path.name + ".prmd")
                if with_ext.exists():
                    resolved_path = with_ext
                else:
                    raise TemplateNotFound(f"Template not found: {template} (resolved to {resolved_path})")
            else:
                raise TemplateNotFound(f"Template not found: {template} (resolved to {resolved_path})")

        # Load the file
        return self._load_file(resolved_path)

    def _load_file(self, file_path: Path) -> Tuple[str, str, callable]:
        """
        Load and process a file.

        Args:
            file_path: Path to the file

        Returns:
            Tuple of (source, filename, uptodate_func)
        """
        # Add to include stack
        self._add_to_stack(str(file_path))

        # Read file content
        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception as e:
            raise TemplateNotFound(f"Failed to read {file_path}: {e}") from e

        # Process based on file extension
        ext = file_path.suffix.lower()

        if ext == ".prmd":
            # Parse .prmd file and extract body only
            processed_content = self._process_prompd_file(content, file_path)
        else:
            # Return raw content for other file types
            processed_content = content

        if self.verbose:
            preview = processed_content[:50].replace("\n", "\\n")
            print(f"[include] Loaded {ext} file: {file_path} ({preview}...)")

        # Return (source, filename, uptodate_func)
        # uptodate_func returns False to always recompile (no caching)
        return (processed_content, str(file_path), lambda: False)

    def _process_prompd_file(self, content: str, file_path: Path) -> str:
        """
        Process a .prmd file: parse frontmatter and return only the body.

        Args:
            content: File content
            file_path: Path to the file (for error messages)

        Returns:
            Body content (after frontmatter)
        """
        try:
            from .parser import PrompdParser

            parser = PrompdParser()
            parsed = parser.parse_content(content)

            if self.verbose:
                param_count = len(parsed.metadata.parameters) if parsed.metadata and parsed.metadata.parameters else 0
                print(f"[include] Parsed .prmd: {file_path} ({param_count} params)")

            # Return just the body content (after frontmatter)
            return parsed.content or ""

        except Exception as e:
            # If parsing fails, log warning and return raw content minus frontmatter
            if self.verbose:
                print(f"[include] Warning: Failed to parse {file_path}: {e}")

            # Simple regex to strip frontmatter
            import re

            without_frontmatter = re.sub(r"^---\r?\n[\s\S]*?\r?\n---\r?\n?", "", content)
            return without_frontmatter

    def _resolve_path(self, name: str) -> Path:
        """
        Resolve a path relative to the base directory.

        Args:
            name: Template name/path

        Returns:
            Resolved absolute path
        """
        path = Path(name)

        # Handle absolute paths
        if path.is_absolute():
            return path

        # Handle relative paths (./file.prmd, ../file.prmd, file.prmd)
        return self.base_dir / path

    def create_child_loader(self, new_base_dir: Path) -> "PrompdLoader":
        """
        Create a child loader for nested includes.
        The child loader shares the compilation ID to use the same include stack.

        Args:
            new_base_dir: Base directory for the child loader

        Returns:
            New PrompdLoader instance
        """
        return PrompdLoader(
            base_dir=new_base_dir,
            verbose=self.verbose,
            max_depth=self.max_depth,
            compilation_id=self.compilation_id,  # Share the compilation ID
        )

    def get_compilation_id(self) -> str:
        """Get the compilation ID for this loader."""
        return self.compilation_id
