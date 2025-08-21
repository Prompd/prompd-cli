"""Enhanced parser for structured .prompd files."""

import re
from pathlib import Path
from typing import Dict, Any, Optional, Tuple

import yaml
from pydantic import ValidationError

from prompd.models import PrompdFile, PrompdMetadata, ParameterDefinition
from prompd.exceptions import ParseError


class PrompdParser:
    """Parser for .prompd (Prompt Definition) files."""
    
    def __init__(self):
        self.section_pattern = re.compile(r'^# (.+)$', re.MULTILINE)
    
    def parse_file(self, file_path: Path) -> PrompdFile:
        """
        Parse a .prompd file into structured format.
        
        Args:
            file_path: Path to .prompd file
            
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
            raise ParseError("Prompd file must start with YAML frontmatter (---)")
        
        # Split frontmatter and content
        parts = content.split("---", 2)
        if len(parts) < 3:
            raise ParseError("Invalid prompd format: missing closing frontmatter delimiter")
        
        yaml_content = parts[1].strip()
        markdown_content = parts[2].strip()
        
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