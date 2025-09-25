"""
Section override processing for prompd inheritance system.

This module provides complete functionality for parsing, validating, and applying
section-based content overrides in prompd template inheritance.
"""

import re
from typing import Dict, List, Optional, Tuple, Set
from pathlib import Path
from dataclasses import dataclass

from .exceptions import ParseError, ValidationError


@dataclass
class SectionInfo:
    """Information about a markdown section."""

    id: str
    heading_text: str
    content: str
    start_line: int
    end_line: int
    heading_level: int


class SectionOverrideProcessor:
    """
    Complete processor for section-based content override functionality.

    Handles parsing markdown into sections, applying overrides, and generating
    final merged content with proper error handling and validation.
    """

    def __init__(self):
        """Initialize the section override processor."""
        # Pattern to match markdown headings (# through ######)
        self.heading_pattern = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)

        # Pattern to match section ID comments
        self.section_id_pattern = re.compile(r'<!--\s*section-id:\s*([a-z0-9-]+)\s*-->', re.IGNORECASE)

    def extract_sections(self, content: str) -> Dict[str, SectionInfo]:
        """
        Extract all sections from markdown content.

        Args:
            content: Markdown content to parse

        Returns:
            Dictionary mapping section IDs to SectionInfo objects

        Raises:
            ParseError: If content cannot be parsed or section IDs are malformed
        """
        if not content or not content.strip():
            return {}

        sections = {}
        lines = content.split('\n')
        current_section_id = None
        current_section_start = 0
        current_heading_text = ""
        current_heading_level = 0

        # Track all section IDs encountered to detect duplicates
        encountered_section_ids = set()

        # Track explicit section ID comments
        explicit_section_ids = {}
        for i, line in enumerate(lines):
            match = self.section_id_pattern.search(line)
            if match:
                section_id = match.group(1)
                self._validate_section_id(section_id, i + 1)
                explicit_section_ids[i] = section_id

        # Find all headings and create sections
        heading_matches = list(self.heading_pattern.finditer(content))

        for i, match in enumerate(heading_matches):
            heading_level = len(match.group(1))  # Number of # characters
            heading_text = match.group(2).strip()
            heading_line = content[:match.start()].count('\n')

            # Determine section ID
            section_id = None

            # Check for explicit section ID comment before this heading (most recent one)
            for line_num in range(heading_line, max(0, heading_line - 5) - 1, -1):
                if line_num in explicit_section_ids:
                    section_id = explicit_section_ids[line_num]
                    break

            # If no explicit ID, generate from heading text
            if section_id is None:
                section_id = self._generate_section_id(heading_text)

            # Validate section ID
            self._validate_section_id(section_id, heading_line + 1)

            # Check for duplicate section IDs
            if section_id in encountered_section_ids:
                raise ParseError(
                    f"Duplicate section ID '{section_id}' found at line {heading_line + 1}. "
                    f"Section IDs must be unique within a template."
                )

            encountered_section_ids.add(section_id)

            # Complete previous section if exists
            if current_section_id is not None:
                end_line = heading_line - 1
                section_content = '\n'.join(lines[current_section_start:end_line + 1]).strip()

                sections[current_section_id] = SectionInfo(
                    id=current_section_id,
                    heading_text=current_heading_text,
                    content=section_content,
                    start_line=current_section_start,
                    end_line=end_line,
                    heading_level=current_heading_level
                )

            # Start new section
            current_section_id = section_id
            current_section_start = heading_line
            current_heading_text = heading_text
            current_heading_level = heading_level

        # Complete final section
        if current_section_id is not None:
            end_line = len(lines) - 1
            section_content = '\n'.join(lines[current_section_start:end_line + 1]).strip()

            sections[current_section_id] = SectionInfo(
                id=current_section_id,
                heading_text=current_heading_text,
                content=section_content,
                start_line=current_section_start,
                end_line=end_line,
                heading_level=current_heading_level
            )

        return sections

    def _generate_section_id(self, heading_text: str) -> str:
        """
        Generate a section ID from heading text using kebab-case convention.

        Args:
            heading_text: The heading text to convert

        Returns:
            Generated section ID in kebab-case format
        """
        # Convert to lowercase and replace non-alphanumeric with hyphens
        section_id = re.sub(r'[^a-z0-9]+', '-', heading_text.lower()).strip('-')

        # Ensure it's not empty
        if not section_id:
            section_id = 'untitled-section'

        return section_id

    def _validate_section_id(self, section_id: str, line_number: int) -> None:
        """
        Validate a section ID format.

        Args:
            section_id: The section ID to validate
            line_number: Line number for error reporting

        Raises:
            ParseError: If section ID format is invalid
        """
        if not section_id:
            raise ParseError(f"Empty section ID at line {line_number}")

        if not re.match(r'^[a-z0-9-]+$', section_id):
            raise ParseError(
                f"Invalid section ID '{section_id}' at line {line_number}. "
                f"Section IDs must use kebab-case (lowercase letters, numbers, hyphens only)."
            )

        if section_id.startswith('-') or section_id.endswith('-'):
            raise ParseError(
                f"Invalid section ID '{section_id}' at line {line_number}. "
                f"Section IDs cannot start or end with hyphens."
            )

        if '--' in section_id:
            raise ParseError(
                f"Invalid section ID '{section_id}' at line {line_number}. "
                f"Section IDs cannot contain consecutive hyphens."
            )

    def validate_overrides_against_parent(
        self,
        overrides: Dict[str, Optional[str]],
        parent_sections: Dict[str, SectionInfo]
    ) -> List[str]:
        """
        Validate override section IDs against parent template sections.

        Args:
            overrides: Override mapping from child template
            parent_sections: Available sections from parent template

        Returns:
            List of validation warning messages (empty if all valid)
        """
        warnings = []
        parent_section_ids = set(parent_sections.keys())

        for section_id in overrides.keys():
            if section_id not in parent_section_ids:
                # Suggest similar section IDs
                suggestions = self._find_similar_section_ids(section_id, parent_section_ids)

                warning_msg = f"Override section '{section_id}' not found in parent template."

                if suggestions:
                    warning_msg += f" Did you mean: {', '.join(suggestions)}?"

                warning_msg += f" Available sections: {', '.join(sorted(parent_section_ids))}"

                warnings.append(warning_msg)

        return warnings

    def _find_similar_section_ids(self, target: str, available: Set[str]) -> List[str]:
        """
        Find similar section IDs using simple string distance.

        Args:
            target: The section ID being searched for
            available: Set of available section IDs

        Returns:
            List of similar section IDs (up to 3 suggestions)
        """
        def levenshtein_distance(s1: str, s2: str) -> int:
            """Calculate Levenshtein distance between two strings."""
            if len(s1) < len(s2):
                return levenshtein_distance(s2, s1)

            if len(s2) == 0:
                return len(s1)

            previous_row = list(range(len(s2) + 1))
            for i, c1 in enumerate(s1):
                current_row = [i + 1]
                for j, c2 in enumerate(s2):
                    insertions = previous_row[j + 1] + 1
                    deletions = current_row[j] + 1
                    substitutions = previous_row[j] + (c1 != c2)
                    current_row.append(min(insertions, deletions, substitutions))
                previous_row = current_row

            return previous_row[-1]

        # Calculate distances and sort by similarity
        candidates = []
        for section_id in available:
            distance = levenshtein_distance(target, section_id)
            # Only suggest if distance is reasonable (allow more lenient matching)
            # Special handling for short targets or when target is substring
            if target in section_id or section_id.startswith(target):
                max_distance = len(section_id)  # Allow any distance for substring matches
            else:
                max_distance = max(4, min(len(target), len(section_id)) // 2 + 3)

            if distance <= max_distance:
                candidates.append((distance, section_id))

        # Sort by distance and return top 3
        candidates.sort(key=lambda x: x[0])
        return [section_id for _, section_id in candidates[:3]]

    def load_override_content(self, override_path: str, base_dir: Path) -> str:
        """
        Load content from an override file path.

        Args:
            override_path: Path to override content file
            base_dir: Base directory for resolving relative paths

        Returns:
            Content from override file

        Raises:
            ValidationError: If file cannot be loaded or is invalid
        """
        try:
            # Resolve path relative to base directory
            if not Path(override_path).is_absolute():
                file_path = base_dir / override_path
            else:
                file_path = Path(override_path)

            # Security check - ensure path doesn't escape base directory
            try:
                if not Path(override_path).is_absolute():
                    resolved_path = file_path.resolve()
                    base_resolved = base_dir.resolve()

                    # Check if the resolved path is within base directory
                    if not str(resolved_path).startswith(str(base_resolved)):
                        raise ValidationError(
                            f"Override path '{override_path}' attempts to access files outside the base directory. "
                            f"For security reasons, override files must be within the project directory."
                        )
            except OSError:
                # If path resolution fails, continue with basic checks
                pass

            # Check if file exists
            if not file_path.exists():
                raise ValidationError(
                    f"Override content file not found at specified path: '{override_path}'. "
                    f"Please verify the file exists and the path is correct."
                )

            # Check if it's a file (not directory)
            if not file_path.is_file():
                raise ValidationError(
                    f"Override path '{override_path}' points to a directory, not a file. "
                    f"Please specify a file path for override content."
                )

            # Load content with encoding detection
            content = self._load_file_with_encoding(file_path)

            return content.strip()

        except ValidationError:
            raise
        except Exception as e:
            raise ValidationError(
                f"Failed to load override content from '{override_path}'. "
                f"Please verify the file exists and is accessible."
            )

    def _load_file_with_encoding(self, file_path: Path) -> str:
        """
        Load file content with automatic encoding detection and security controls.

        Args:
            file_path: Path to file to load

        Returns:
            File content as string

        Raises:
            ValidationError: If file cannot be read or security checks fail
        """
        # Security Control 1: File size limit (1MB max for override files)
        MAX_OVERRIDE_FILE_SIZE = 1024 * 1024  # 1MB
        try:
            file_size = file_path.stat().st_size
            if file_size > MAX_OVERRIDE_FILE_SIZE:
                raise ValidationError(
                    f"Override file exceeds maximum size limit of {MAX_OVERRIDE_FILE_SIZE // 1024}KB. "
                    f"File size: {file_size // 1024}KB. Please use a smaller file."
                )
        except OSError:
            raise ValidationError("Unable to access override file for security validation.")

        # Security Control 2: Symlink protection
        try:
            if file_path.is_symlink():
                raise ValidationError(
                    "Override files cannot be symbolic links for security reasons. "
                    "Please use regular files only."
                )
        except OSError:
            # If we can't check symlink status, err on the side of caution
            raise ValidationError("Unable to verify file type for security validation.")

        # Try common encodings in order of preference
        encodings = ['utf-8', 'utf-8-sig', 'latin-1', 'cp1252']

        for encoding in encodings:
            try:
                with open(file_path, 'r', encoding=encoding) as f:
                    return f.read()
            except UnicodeDecodeError:
                continue
            except Exception:
                # Security Control 3: Sanitized error messages
                raise ValidationError(
                    "Failed to read override file. Please ensure the file exists, "
                    "is readable, and uses a supported text encoding (UTF-8 recommended)."
                )

        raise ValidationError(
            "Override file uses an unsupported text encoding. "
            "Please save the file in UTF-8 format."
        )

    def apply_overrides(
        self,
        parent_sections: Dict[str, SectionInfo],
        child_sections: Dict[str, SectionInfo],
        overrides: Dict[str, Optional[str]],
        base_dir: Path,
        verbose: bool = False
    ) -> str:
        """
        Apply section overrides to merge parent and child content.

        Args:
            parent_sections: Sections from parent template
            child_sections: Sections from child template
            overrides: Override mapping (section_id -> file_path or None)
            base_dir: Base directory for resolving override file paths
            verbose: Whether to print verbose information

        Returns:
            Final merged content with overrides applied

        Raises:
            ValidationError: If override application fails
        """
        if verbose:
            print(f"Applying {len(overrides)} section overrides...")

        # Start with parent sections, maintaining order
        final_sections = {}
        parent_section_order = list(parent_sections.keys())

        # Apply overrides
        for section_id in parent_section_order:
            if section_id in overrides:
                override_path = overrides[section_id]

                if override_path is None:
                    # Section removal
                    if verbose:
                        print(f"  - Removing section '{section_id}'")
                    continue
                else:
                    # Section replacement
                    try:
                        override_content = self.load_override_content(override_path, base_dir)

                        # Create new section info with override content
                        original_section = parent_sections[section_id]
                        final_sections[section_id] = SectionInfo(
                            id=section_id,
                            heading_text=original_section.heading_text,
                            content=f"{'#' * original_section.heading_level} {original_section.heading_text}\n\n{override_content}",
                            start_line=0,  # Reset for merged content
                            end_line=0,
                            heading_level=original_section.heading_level
                        )

                        if verbose:
                            print(f"  - Replacing section '{section_id}' with content from {override_path}")

                    except ValidationError as e:
                        raise ValidationError(f"Error applying override for section '{section_id}': {e}")
            else:
                # Keep parent section as-is
                final_sections[section_id] = parent_sections[section_id]
                if verbose:
                    print(f"  - Keeping section '{section_id}' from parent")

        # Add any child sections that don't override parent sections
        for section_id, section_info in child_sections.items():
            if section_id not in parent_sections and section_id not in overrides:
                final_sections[section_id] = section_info
                if verbose:
                    print(f"  - Adding new section '{section_id}' from child")

        # Generate final content
        content_parts = []
        for section_info in final_sections.values():
            content_parts.append(section_info.content)

        final_content = '\n\n'.join(content_parts)

        if verbose:
            print(f"Generated final content with {len(final_sections)} sections")

        return final_content

    def get_section_summary(self, sections: Dict[str, SectionInfo]) -> List[Tuple[str, str, int]]:
        """
        Get a summary of sections for display purposes.

        Args:
            sections: Dictionary of sections

        Returns:
            List of tuples (section_id, formatted_heading_text, content_length)
        """
        summary = []
        for section_id, section_info in sections.items():
            content_length = len(section_info.content.strip())
            # Format heading text with markdown level indicators
            heading_prefix = "#" * section_info.heading_level
            formatted_heading = f"{heading_prefix} {section_info.heading_text}"
            summary.append((section_id, formatted_heading, content_length))

        return sorted(summary, key=lambda x: x[0])  # Sort by section ID