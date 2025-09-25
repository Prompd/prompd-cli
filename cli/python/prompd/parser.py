"""Enhanced parser for structured .prmd files."""

import re
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List

import yaml
from pydantic import ValidationError

from prompd.models import PrompdFile, PrompdMetadata, ParameterDefinition
from prompd.exceptions import ParseError
from prompd.section_override_processor import SectionOverrideProcessor, SectionInfo


class PrompdParser:
    """Parser for .prmd (Prompt Definition) files."""
    
    def __init__(self):
        self.section_pattern = re.compile(r'^# (.+)$', re.MULTILINE)
        self.section_processor = SectionOverrideProcessor()
    
    def parse_file(self, file_path: Path) -> PrompdFile:
        """
        Parse a .prmd file into structured format.
        
        Args:
            file_path: Path to .prmd file
            
        Returns:
            Parsed PrompdFile object
            
        Raises:
            ParseError: If file cannot be parsed
        """
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception as e:
            raise ParseError(f"Failed to read file {file_path}: {e}")
        
        prompd = self.parse_content(content)
        prompd.file_path = file_path
        return prompd
    
    def parse_content(self, content: str) -> PrompdFile:
        """
        Parse prompd content into structured format.
        
        Args:
            content: Full prompd file content
            
        Returns:
            Parsed PrompdFile object
            
        Raises:
            ParseError: If content cannot be parsed
        """
        # Check for frontmatter delimiters
        if not content.startswith("---"):
            raise ParseError("Prmd file must start with YAML frontmatter (---)")
        
        # Split frontmatter and content
        parts = content.split("---", 2)
        if len(parts) < 3:
            raise ParseError("Invalid prmd format: missing closing frontmatter delimiter")
        
        yaml_content = parts[1].strip()
        markdown_content = parts[2].strip()
        
        # Pre-process YAML to handle package references with @ symbols
        yaml_content = self._preprocess_package_references(yaml_content)
        
        # Parse YAML frontmatter
        try:
            metadata_dict = yaml.safe_load(yaml_content) or {}
        except yaml.YAMLError as e:
            raise ParseError(f"Invalid YAML frontmatter: {e}")
        
        # Validate and create metadata object
        try:
            metadata = PrompdMetadata(**metadata_dict)
        except ValidationError as e:
            raise ParseError(f"Invalid metadata: {e}")
        
        # Parse sections from markdown content
        sections = self._parse_sections(markdown_content)
        
        # Create and return PrompdFile
        return PrompdFile(
            metadata=metadata,
            content=markdown_content,
            sections=sections
        )
    
    def _preprocess_package_references(self, yaml_content: str) -> str:
        """
        Pre-process YAML to validate and quote package references with @ symbols.
        
        Scans all YAML fields recursively to identify package references (strings starting with @),
        validates they exist, and quotes them for proper YAML parsing.
        
        Args:
            yaml_content: Raw YAML content
            
        Returns:
            Processed YAML content with validated and quoted package references
        """
        import yaml
        import re
        from typing import Any, Dict, List, Union
        
        try:
            # First attempt to parse YAML to identify structure
            # Use safe_load with custom resolver to handle @ symbols temporarily
            class CustomLoader(yaml.SafeLoader):
                pass
            
            def package_reference_constructor(loader, node):
                # Return the raw string value for @ references
                return loader.construct_scalar(node)
            
            # Add constructor for handling @ symbols temporarily
            CustomLoader.add_constructor('tag:yaml.org,2002:str', package_reference_constructor)
            
            try:
                data = yaml.load(yaml_content, Loader=CustomLoader)
            except yaml.YAMLError:
                # If YAML parsing fails, fall back to regex approach for @ symbols
                return self._regex_quote_package_references(yaml_content)
                
            if not isinstance(data, dict):
                return yaml_content
                
            # Process all fields recursively to find package references
            processed = yaml_content
            package_refs = self._find_all_package_references(data)
            
            for field_path, package_ref in package_refs:
                # Validate package reference exists
                if not self._validate_package_exists(package_ref):
                    raise ParseError(f"Package reference not found: {package_ref}")
                
                # Quote the validated reference based on its context
                processed = self._quote_package_reference(processed, field_path, package_ref)
                            
            return processed
            
        except Exception:
            # Fall back to regex approach if structured parsing fails
            return self._regex_quote_package_references(yaml_content)
    
    def _find_all_package_references(self, data, current_path="") -> List[Tuple[str, str]]:
        """
        Recursively find all package references (strings starting with @) in YAML data.
        
        Args:
            data: Parsed YAML data structure
            current_path: Current field path for context
            
        Returns:
            List of (field_path, package_reference) tuples
        """
        from typing import Any, Dict, List, Union, Tuple
        
        package_refs = []
        
        if isinstance(data, dict):
            for key, value in data.items():
                field_path = f"{current_path}.{key}" if current_path else key
                
                if isinstance(value, str) and value.startswith('@'):
                    package_refs.append((field_path, value))
                elif isinstance(value, list):
                    # Handle arrays
                    for i, item in enumerate(value):
                        if isinstance(item, str) and item.startswith('@'):
                            package_refs.append((f"{field_path}[{i}]", item))
                        elif isinstance(item, dict):
                            # Handle objects in arrays (like using: array)
                            nested_refs = self._find_all_package_references(item, f"{field_path}[{i}]")
                            package_refs.extend(nested_refs)
                elif isinstance(value, dict):
                    # Recursively process nested objects
                    nested_refs = self._find_all_package_references(value, field_path)
                    package_refs.extend(nested_refs)
                    
        return package_refs
    
    def _quote_package_reference(self, yaml_content: str, field_path: str, package_ref: str) -> str:
        """
        Quote a specific package reference in YAML content based on its field path.
        
        Args:
            yaml_content: Current YAML content
            field_path: Path to the field (e.g., "inherits", "context[0]", "using[0].package")
            package_ref: Package reference to quote
            
        Returns:
            Updated YAML content with quoted package reference
        """
        import re
        
        escaped_ref = re.escape(package_ref)
        
        # Handle different field path patterns
        if '[' in field_path:
            # Array context: field[index] or field[index].subfield
            if '.package' in field_path:
                # using[0].package format
                pattern = rf'(\s*package:\s*)({escaped_ref})'
                replacement = rf'\1"\2"'
            else:
                # Array item: context[0] format
                pattern = rf'(\s*-\s*)({escaped_ref})'
                replacement = rf'\1"\2"'
        else:
            # Simple field: field_name format
            field_name = field_path.split('.')[0]  # Get root field name
            pattern = rf'(\s*{field_name}:\s*)({escaped_ref})'
            replacement = rf'\1"\2"'
        
        return re.sub(pattern, replacement, yaml_content)
    
    def _regex_quote_package_references(self, yaml_content: str) -> str:
        """Fallback regex-based approach for quoting package references."""
        import re
        
        patterns = [
            # Generic pattern for any field: field_name: @package -> field_name: "@package"
            (r'(\s*[a-zA-Z_][a-zA-Z0-9_]*:\s*)(@[^\s]+)', r'\1"\2"'),
            # Array items: - @package -> - "@package"
            (r'(\s*-\s*)(@[^\s]+)', r'\1"\2"'),
        ]
        
        processed = yaml_content
        for pattern, replacement in patterns:
            processed = re.sub(pattern, replacement, processed)
            
        return processed
    
    def _validate_package_exists(self, package_ref: str) -> bool:
        """
        Validate that a package reference exists and is accessible.
        
        Args:
            package_ref: Package reference like @prompd.io/core-patterns@2.0.0
            
        Returns:
            True if package exists and is accessible, False otherwise
        """
        try:
            # Import here to avoid circular imports
            from .package_resolver import PackageResolver
            
            resolver = PackageResolver()
            # Try to resolve the package - this will raise an exception if not found
            resolved_path = resolver.resolve_package(package_ref)
            return resolved_path is not None
            
        except Exception as e:
            # For now, log the error and return False
            # In production, we might want more sophisticated error handling
            if hasattr(self, 'verbose') and self.verbose:
                print(f"Package validation warning: {package_ref} - {e}")
            return False  # Temporarily return False until package resolver is fully integrated
    
    def _parse_sections(self, content: str) -> Dict[str, str]:
        """
        Parse markdown sections from content.
        
        Args:
            content: Markdown content to parse
            
        Returns:
            Dictionary mapping section names to content
        """
        sections = {}
        
        # Find all sections (# Section Name)
        matches = list(self.section_pattern.finditer(content))
        
        if not matches:
            # No sections found - treat entire content as user prompt
            return {"user": content.strip()}
        
        # Extract sections
        for i, match in enumerate(matches):
            section_name = match.group(1).lower().replace(' ', '-')
            start_pos = match.end()
            
            # Find end position (next section or end of content)
            if i + 1 < len(matches):
                end_pos = matches[i + 1].start()
            else:
                end_pos = len(content)
            
            # Extract section content
            section_content = content[start_pos:end_pos].strip()
            sections[section_name] = section_content
        
        return sections
    
    def resolve_content_reference(
        self, 
        reference: Optional[str], 
        sections: Dict[str, str],
        base_path: Optional[Path] = None
    ) -> Optional[str]:
        """
        Resolve a content reference to actual content.
        
        Args:
            reference: Content reference (file path, #section, or None)
            sections: Available sections in current file
            base_path: Base path for relative file references
            
        Returns:
            Resolved content or None
            
        Raises:
            ParseError: If reference cannot be resolved
        """
        if not reference:
            return None
        
        # Section reference (#section-name)
        if reference.startswith('#'):
            section_name = reference[1:]
            if section_name in sections:
                return sections[section_name]
            else:
                raise ParseError(f"Section '{section_name}' not found")
        
        # File reference (./path/to/file.md)
        elif reference.startswith('./') or reference.startswith('/'):
            file_path = Path(reference)
            if not file_path.is_absolute() and base_path:
                file_path = base_path.parent / file_path
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    return f.read().strip()
            except Exception as e:
                raise ParseError(f"Failed to read referenced file {file_path}: {e}")
        
        # Inline content
        else:
            return reference
    
    def get_structured_content(
        self, 
        prompd: PrompdFile,
        parameters: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Optional[str]]:
        """
        Get structured content with references resolved.
        
        Args:
            prompd: Parsed prompd file
            parameters: Parameters for substitution (optional)
            
        Returns:
            Dict with resolved system/context/user/response content
        """
        base_path = prompd.file_path
        sections = prompd.sections
        metadata = prompd.metadata
        
        # Resolve content references
        resolved_content = {}
        
        for content_type in ['system', 'context', 'user', 'response']:
            reference = getattr(metadata, content_type, None)
            
            if reference:
                resolved_content[content_type] = self.resolve_content_reference(
                    reference, sections, base_path
                )
            elif content_type == 'user' and not reference:
                # If no user section specified, use entire content or default section
                if 'user' in sections:
                    resolved_content[content_type] = sections['user']
                elif len(sections) == 0:
                    # No sections at all - entire content is user
                    resolved_content[content_type] = prompd.content
                else:
                    resolved_content[content_type] = None
            else:
                resolved_content[content_type] = None
        
        return resolved_content
    
    def extract_variables(self, content: str) -> set:
        """
        Extract variable references from content.
        
        Args:
            content: Content with variable placeholders
            
        Returns:
            Set of variable names found in content
        """
        # Find all {variable} patterns
        simple_vars = re.findall(r'\{([a-zA-Z_][a-zA-Z0-9_]*)\}', content)
        
        # Find all {inputs.variable} patterns
        nested_vars = re.findall(r'\{inputs\.([a-zA-Z_][a-zA-Z0-9_]*)\}', content)
        
        # Find variables in conditional logic
        conditional_vars = re.findall(r'\{%-?\s*if\s+([a-zA-Z_][a-zA-Z0-9_]*)', content)
        
        return set(simple_vars + nested_vars + conditional_vars)

    def extract_sections_with_info(self, content: str) -> Dict[str, SectionInfo]:
        """
        Extract detailed section information from markdown content.

        Args:
            content: Markdown content to parse

        Returns:
            Dictionary mapping section IDs to SectionInfo objects

        Raises:
            ParseError: If content cannot be parsed or section IDs are malformed
        """
        return self.section_processor.extract_sections(content)

    def extract_sections_from_file(self, file_path: Path) -> Dict[str, SectionInfo]:
        """
        Extract sections from a .prmd file.

        Args:
            file_path: Path to .prmd file

        Returns:
            Dictionary mapping section IDs to SectionInfo objects

        Raises:
            ParseError: If file cannot be parsed or contains invalid sections
        """
        try:
            parsed_file = self.parse_file(file_path)
            if parsed_file.content:
                return self.extract_sections_with_info(parsed_file.content)
            else:
                return {}
        except Exception as e:
            raise ParseError(f"Failed to extract sections from {file_path}: {e}")

    def get_section_summary(self, file_path: Path) -> List[Tuple[str, str, int]]:
        """
        Get a summary of sections in a .prmd file for display purposes.

        Args:
            file_path: Path to .prmd file

        Returns:
            List of tuples (section_id, heading_text, content_length)

        Raises:
            ParseError: If file cannot be parsed
        """
        sections = self.extract_sections_from_file(file_path)
        return self.section_processor.get_section_summary(sections)

    def validate_overrides_against_parent(
        self,
        child_file: Path,
        parent_file: Path
    ) -> List[str]:
        """
        Validate override section IDs in child file against parent template.

        Args:
            child_file: Path to child template file
            parent_file: Path to parent template file

        Returns:
            List of validation warning messages (empty if all valid)

        Raises:
            ParseError: If files cannot be parsed
        """
        try:
            # Parse child file to get overrides
            child_parsed = self.parse_file(child_file)
            overrides = child_parsed.metadata.override if child_parsed.metadata else {}

            if not overrides:
                return []  # No overrides to validate

            # Extract parent sections
            parent_sections = self.extract_sections_from_file(parent_file)

            # Validate overrides
            return self.section_processor.validate_overrides_against_parent(
                overrides, parent_sections
            )

        except Exception as e:
            raise ParseError(f"Failed to validate overrides: {e}")