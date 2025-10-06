"""
Prompd Compiler - Composable prompt compilation system.

This module implements the multi-stage compilation pipeline that transforms
.prmd files into various output formats (markdown, provider JSON, etc.)
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, Any, List, Optional, Union, Protocol
from pathlib import Path
import json
import yaml
from enum import Enum

from .models import PrompdFile, PrompdMetadata
from .parser import PrompdParser
from .exceptions import PrompdError
from .section_override_processor import SectionOverrideProcessor


class CompilationStage(str, Enum):
    """Stages of the compilation pipeline."""
    LEXICAL_ANALYSIS = "lexical_analysis"
    DEPENDENCY_RESOLUTION = "dependency_resolution"
    SEMANTIC_ANALYSIS = "semantic_analysis"
    ASSET_EXTRACTION = "asset_extraction"
    TEMPLATE_PROCESSING = "template_processing"
    CODE_GENERATION = "code_generation"


@dataclass
class CompilationContext:
    """Context passed between compilation stages."""
    source_file: Path
    metadata: Optional[PrompdMetadata] = None
    content: Optional[str] = None
    dependencies: Dict[str, Any] = None
    parameters: Dict[str, Any] = None
    contexts: List[str] = None
    errors: List[str] = None
    warnings: List[str] = None
    output_format: str = "markdown"
    compiled_result: Optional[Union[str, bytes]] = None
    verbose: bool = False
    
    def __post_init__(self):
        if self.dependencies is None:
            self.dependencies = {}
        if self.parameters is None:
            self.parameters = {}
        if self.contexts is None:
            self.contexts = []
        if self.errors is None:
            self.errors = []
        if self.warnings is None:
            self.warnings = []


class CompilerStage(ABC):
    """Abstract base class for compiler pipeline stages."""
    
    @abstractmethod
    def process(self, context: CompilationContext) -> None:
        """Process the compilation context through this stage."""
        pass
    
    @abstractmethod
    def get_name(self) -> str:
        """Get the name of this compilation stage."""
        pass


class LexicalAnalysisStage(CompilerStage):
    """Parse YAML frontmatter + Markdown content."""
    
    def __init__(self):
        self.parser = PrompdParser()
    
    def process(self, context: CompilationContext) -> None:
        """Parse the .prmd file into metadata and content."""
        try:
            prompd_file = self.parser.parse_file(context.source_file)
            context.metadata = prompd_file.metadata
            context.content = prompd_file.content
        except Exception as e:
            context.errors.append(f"Lexical analysis failed: {e}")
    
    def get_name(self) -> str:
        return "Lexical Analysis"


class DependencyResolutionStage(CompilerStage):
    """Resolve 'using:' imports and 'inherits:' chains."""
    
    def __init__(self):
        from .package_resolver import package_resolver
        self.resolver = package_resolver
    
    def process(self, context: CompilationContext) -> None:
        """Resolve package dependencies and inheritance."""
        if not context.metadata:
            return
        
        # Initialize resolved packages dict
        resolved_packages = {}

        # Process 'using' field (package imports with optional prefixes)
        if hasattr(context.metadata, 'using') and context.metadata.using:
            using_imports = context.metadata.using
            
            # Handle different using formats
            if isinstance(using_imports, str):
                # Simple string: using: "@package@version"
                try:
                    package_path = self.resolver.resolve_package(using_imports)
                    resolved_packages[using_imports] = {
                        'path': package_path,
                        'prefix': None
                    }
                    if context.verbose:
                        print(f"Resolved package: {using_imports} -> {package_path}")
                except Exception as e:
                    context.warnings.append(f"Failed to resolve package {using_imports}: {e}")
                    
            elif isinstance(using_imports, list):
                # List of packages (can be strings, dicts, or UsingPackage objects)
                for item in using_imports:
                    if isinstance(item, str):
                        # Simple string in list
                        try:
                            package_path = self.resolver.resolve_package(item)
                            resolved_packages[item] = {
                                'path': package_path,
                                'prefix': None
                            }
                            if context.verbose:
                                print(f"Resolved package: {item} -> {package_path}")
                        except Exception as e:
                            context.warnings.append(f"Failed to resolve package {item}: {e}")
                    elif hasattr(item, 'name') and hasattr(item, 'prefix'):
                        # UsingPackage object
                        package_ref = item.name
                        prefix = item.prefix

                        # Prefix is required for 'using' - the whole point is to create a shorthand
                        if not prefix:
                            context.errors.append(f"Package '{package_ref}' in 'using' field must have a prefix for shorthand access")
                            continue

                        try:
                            package_path = self.resolver.resolve_package(package_ref)
                            resolved_packages[package_ref] = {
                                'path': package_path,
                                'prefix': prefix
                            }
                            if context.verbose:
                                print(f"Resolved package: {package_ref} -> {package_path} (prefix: {prefix})")
                        except Exception as e:
                            context.warnings.append(f"Failed to resolve package {package_ref}: {e}")
                    elif isinstance(item, dict):
                        # Dict with name and REQUIRED prefix
                        package_ref = item.get('name', item.get('package', ''))
                        prefix = item.get('prefix')

                        if package_ref:
                            # Prefix is required for 'using' - the whole point is to create a shorthand
                            if not prefix:
                                context.errors.append(f"Package '{package_ref}' in 'using' field must have a prefix for shorthand access")
                                continue

                            try:
                                package_path = self.resolver.resolve_package(package_ref)
                                resolved_packages[package_ref] = {
                                    'path': package_path,
                                    'prefix': prefix
                                }
                                if context.verbose:
                                    print(f"Resolved package: {package_ref} -> {package_path} (prefix: {prefix})")
                            except Exception as e:
                                context.warnings.append(f"Failed to resolve package {package_ref}: {e}")
                                
            elif isinstance(using_imports, dict):
                # Dict format: {package: prefix} or structured format
                for key, value in using_imports.items():
                    if isinstance(value, str):
                        # Format: {"@package@version": "prefix"}
                        try:
                            package_path = self.resolver.resolve_package(key)
                            resolved_packages[key] = {
                                'path': package_path,
                                'prefix': value
                            }
                            if context.verbose:
                                print(f"Resolved package: {key} -> {package_path} (prefix: {value})")
                        except Exception as e:
                            context.warnings.append(f"Failed to resolve package {key}: {e}")
                    elif isinstance(value, dict) and 'prefix' in value:
                        # Format: {"@package@version": {"prefix": "alias"}}
                        try:
                            package_path = self.resolver.resolve_package(key)
                            resolved_packages[key] = {
                                'path': package_path,
                                'prefix': value.get('prefix')
                            }
                            if context.verbose:
                                if value.get('prefix'):
                                    print(f"Resolved package: {key} -> {package_path} (prefix: {value.get('prefix')})")
                                else:
                                    print(f"Resolved package: {key} -> {package_path}")
                        except Exception as e:
                            context.warnings.append(f"Failed to resolve package {key}: {e}")
            
            context.dependencies['imports'] = resolved_packages
        
        # Process 'inherits' field (can be package reference or direct file path)
        if hasattr(context.metadata, 'inherits') and context.metadata.inherits:
            inherits_ref = context.metadata.inherits

            # Resolve aliases in inherits field (e.g., "@pkg/templates/file.prmd" -> "@scope/package@version/templates/file.prmd")
            resolved_inherits_ref = self._resolve_alias_in_path(inherits_ref, resolved_packages)

            if resolved_inherits_ref != inherits_ref:
                inherits_ref = resolved_inherits_ref
                # Update the metadata with the resolved reference
                context.metadata.inherits = inherits_ref
                if context.verbose:
                    print(f"Resolved alias in inherits: {inherits_ref}")
            
            # Check if it's a local file path (starts with . or / or doesn't start with @)
            if inherits_ref.startswith(('./', '../', '/')) or (not inherits_ref.startswith('@') and '.prmd' in inherits_ref):
                # Direct file path - resolve relative to source file
                from pathlib import Path
                source_dir = Path(context.source_file).parent if context.source_file else Path.cwd()
                parent_path = source_dir / inherits_ref
                context.dependencies['inherits'] = str(parent_path.resolve())
                if context.verbose:
                    print(f"Resolved inheritance file: {inherits_ref} -> {parent_path.resolve()}")
            else:
                # Package reference with file path - resolve through package system
                try:
                    # Parse package reference and file path
                    # Format: @namespace/package@version/path/to/file.prmd
                    import re
                    pattern = r'^(@[\w.-]+/[\w.-]+@[\w.-]+)/(.+)$'
                    match = re.match(pattern, inherits_ref)

                    if match:
                        package_ref = match.group(1)  # @namespace/package@version
                        file_path_in_package = match.group(2)  # path/to/file.prmd

                        if context.verbose:
                            print(f"Parsing package inheritance: {package_ref} / {file_path_in_package}")

                        # Resolve the package to its local path
                        package_path = self.resolver.resolve_package(package_ref)

                        # Construct full path to the inherited file
                        full_file_path = package_path / file_path_in_package
                        context.dependencies['inherits'] = str(full_file_path)

                        if context.verbose:
                            print(f"Resolved inheritance package: {inherits_ref} -> {full_file_path}")
                    else:
                        # Fallback: try as direct package reference
                        parent_path = self.resolver.resolve_package(inherits_ref)
                        context.dependencies['inherits'] = parent_path
                        if context.verbose:
                            print(f"Resolved inheritance package (direct): {inherits_ref} -> {parent_path}")

                except Exception as e:
                    context.warnings.append(f"Failed to resolve inheritance {inherits_ref}: {e}")

        # Process content reference fields (system, context, user, assistant, response) for alias resolution
        content_fields = ['system', 'assistant', 'context', 'user', 'response']
        for field_name in content_fields:
            if hasattr(context.metadata, field_name):
                field_value = getattr(context.metadata, field_name)

                if field_value:
                    # Handle both single strings and lists of strings
                    if isinstance(field_value, str):
                        resolved_value = self._resolve_alias_in_path(field_value, resolved_packages)
                        if resolved_value != field_value:
                            setattr(context.metadata, field_name, resolved_value)
                            if context.verbose:
                                print(f"Resolved alias in {field_name}: {field_value} -> {resolved_value}")
                    elif isinstance(field_value, list):
                        resolved_list = []
                        for item in field_value:
                            if isinstance(item, str):
                                resolved_item = self._resolve_alias_in_path(item, resolved_packages)
                                resolved_list.append(resolved_item)
                                if resolved_item != item and context.verbose:
                                    print(f"Resolved alias in {field_name}: {item} -> {resolved_item}")
                            else:
                                resolved_list.append(item)
                        setattr(context.metadata, field_name, resolved_list)

    def _resolve_alias_in_path(self, path: str, resolved_packages: dict) -> str:
        """
        Resolve alias prefixes in file paths.

        Examples:
        - "@pkg/templates/file.prmd" with "@pkg" aliased to "@scope/package@version"
          becomes "@scope/package@version/templates/file.prmd"
        """
        if not path.startswith('@') or '/' not in path:
            return path

        # Extract the potential alias (everything before the first '/')
        parts = path.split('/', 1)
        potential_alias = parts[0]  # e.g., "@pkg"
        remaining_path = parts[1]   # e.g., "templates/file.prmd"

        # Look for this alias in resolved packages
        for package_name, package_info in resolved_packages.items():
            if isinstance(package_info, dict) and package_info.get('prefix') == potential_alias:
                # Found the alias! Replace it with the full package name
                resolved_path = f"{package_name}/{remaining_path}"
                return resolved_path

        # No alias found, return original path
        return path

    def get_name(self) -> str:
        return "Dependency Resolution"


class SemanticAnalysisStage(CompilerStage):
    """Validate parameters and references."""
    
    def process(self, context: CompilationContext) -> None:
        """Validate semantic correctness of the prompt and merge default values."""
        if not context.metadata:
            return

        # Merge default parameter values and validate required parameters
        if context.metadata.parameters:
            for param in context.metadata.parameters:
                # Add default value if parameter not provided
                if param.name not in context.parameters and param.default is not None:
                    context.parameters[param.name] = param.default
                    if context.verbose:
                        print(f"Using default value for parameter '{param.name}': {param.default}")

                # Validate required parameters
                if param.required and param.name not in context.parameters:
                    context.warnings.append(f"Required parameter '{param.name}' not provided")
    
    def get_name(self) -> str:
        return "Semantic Analysis"


class AssetExtractionStage(CompilerStage):
    """Extract content from binary files (Excel, Word, PDF, etc.)."""
    
    def __init__(self):
        from .extractors import binary_extractor
        self.extractor = binary_extractor
    
    def process(self, context: CompilationContext) -> None:
        """Extract text from binary file formats."""
        if not context.metadata:
            return
        
        # Process context files from metadata
        context_files = []
        if hasattr(context.metadata, 'context') and context.metadata.context:
            if isinstance(context.metadata.context, list):
                context_files.extend([str(f) for f in context.metadata.context])
            else:
                context_files.append(str(context.metadata.context))
        
        # Extract content from each context file
        for ctx_file_str in context_files:
            ctx_file = Path(ctx_file_str)
            
            # Resolve relative paths relative to source file
            if not ctx_file.is_absolute():
                ctx_file = context.source_file.parent / ctx_file
            
            if ctx_file.exists():
                try:
                    extracted_content = self.extractor.extract(ctx_file)
                    context.contexts.append(f"## Context from {ctx_file.name}\n\n{extracted_content}")
                except Exception as e:
                    context.errors.append(f"Failed to extract content from {ctx_file}: {e}")
                    return  # Stop processing on extraction failure
            else:
                context.errors.append(f"Context file not found: {ctx_file}")
                return  # Stop processing on missing file
    
    def get_name(self) -> str:
        return "Asset Extraction"


class FileValidationStage(CompilerStage):
    """Validate that all referenced files exist."""
    
    def process(self, context: CompilationContext) -> None:
        """Validate all file references in metadata."""
        if not context.metadata:
            return
            
        source_dir = context.source_file.parent if context.source_file else Path.cwd()
        
        # Validate system files
        if context.metadata.system:
            self._validate_file_reference(context, source_dir, context.metadata.system, "system")
            
        # Validate assistant files  
        if context.metadata.assistant:
            self._validate_file_reference(context, source_dir, context.metadata.assistant, "assistant")
            
        # Validate context files
        if context.metadata.context:
            self._validate_file_reference(context, source_dir, context.metadata.context, "context")
            
        # Validate user files
        if context.metadata.user:
            self._validate_file_reference(context, source_dir, context.metadata.user, "user")
            
        # Validate response files
        if context.metadata.response:
            self._validate_file_reference(context, source_dir, context.metadata.response, "response")
            
        # Validate inherits files (local file paths only, not package references)
        if context.metadata.inherits and not context.metadata.inherits.startswith('@'):
            self._validate_file_reference(context, source_dir, context.metadata.inherits, "inherits")
    
    def _validate_file_reference(self, context: CompilationContext, source_dir: Path, 
                                file_ref: Union[str, List[str]], ref_type: str) -> None:
        """Validate a file reference (single file or list of files)."""
        if isinstance(file_ref, str):
            file_refs = [file_ref]
        else:
            file_refs = file_ref
            
        for file_path_str in file_refs:
            file_path = Path(file_path_str)
            
            # Resolve relative paths relative to source file
            if not file_path.is_absolute():
                file_path = source_dir / file_path
                
            if not file_path.exists():
                context.errors.append(f"Referenced {ref_type} file not found: {file_path}")
                return  # Stop on first missing file
    
    def get_name(self) -> str:
        return "File Validation"


class TemplateProcessingStage(CompilerStage):
    """Process Handlebars-style templates, package references, and section overrides."""

    def __init__(self):
        """Initialize the template processing stage."""
        self.section_processor = SectionOverrideProcessor()

    def _convert_handlebars_to_jinja2(self, content: str) -> str:
        """Convert common Handlebars syntax to Jinja2 syntax for broader compatibility."""
        import re

        # Convert {{#if condition}} to {% if condition %}
        content = re.sub(r'\{\{#if\s+([^}]+)\}\}', r'{% if \1 %}', content)

        # Convert {{#unless condition}} to {% if not condition %}
        content = re.sub(r'\{\{#unless\s+([^}]+)\}\}', r'{% if not \1 %}', content)

        # Convert {{#each items}} to {% for item in items %}
        content = re.sub(r'\{\{#each\s+([^}]+)\}\}', r'{% for item in \1 %}', content)

        # Convert {{/if}}, {{/unless}}, {{/each}} to {% endif %}, {% endfor %}
        content = re.sub(r'\{\{/(if|unless)\}\}', r'{% endif %}', content)
        content = re.sub(r'\{\{/each\}\}', r'{% endfor %}', content)

        # Handle {{#switch}} and {{#case}} - convert to if/elif chain
        # This is complex, so we'll do a more sophisticated conversion

        # First, convert {{#switch var}} to set the switch variable
        switch_pattern = r'\{\{#switch\s+([^}]+)\}\}'
        content = re.sub(switch_pattern, r'{% set _switch_var = \1 %}', content)

        # Convert {{#case "value"}} to {% if _switch_var == "value" %}
        # Handle quoted cases first, then unquoted
        case_pattern_quoted = r'\{\{#case\s+"([^"]+)"\}\}'
        content = re.sub(case_pattern_quoted, r'{% if _switch_var == "\1" %}', content)

        # Handle unquoted cases (but not if they were already converted)
        case_pattern_unquoted = r'\{\{#case\s+([^}"]+)\}\}'
        content = re.sub(case_pattern_unquoted, r'{% if _switch_var == \1 %}', content)

        # Convert {{#default}} to {% else %}
        content = re.sub(r'\{\{#default\}\}', r'{% else %}', content)

        # Convert {{/case}} to {% endif %} - but be careful with nesting
        content = re.sub(r'\{\{/case\}\}', r'{% endif %}', content)

        # Convert {{/switch}} to empty (the last case's endif handles it)
        content = re.sub(r'\{\{/switch\}\}', '', content)

        return content

    def _enhanced_simple_substitution(self, content: str, parameters: dict) -> str:
        """Enhanced simple substitution that handles nested object properties."""
        import re

        def replace_nested(match):
            """Replace nested property references like {obj.prop}."""
            full_path = match.group(1)

            # Split the path (e.g., "meeting_info.title" -> ["meeting_info", "title"])
            parts = full_path.split('.')

            # Start with the root parameter
            value = parameters.get(parts[0])
            if value is None:
                return f"[Missing: {full_path}]"

            # Navigate through nested properties
            try:
                for part in parts[1:]:
                    if isinstance(value, dict):
                        value = value.get(part)
                    else:
                        # If it's not a dict, try to get the attribute (for objects)
                        value = getattr(value, part, None)

                    if value is None:
                        return f"[Missing: {full_path}]"

                return str(value)
            except (AttributeError, KeyError, TypeError):
                return f"[Missing: {full_path}]"

        # Handle nested properties like {obj.prop} or {obj.nested.prop}
        content = re.sub(r'\{([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\}', replace_nested, content)

        # Handle simple properties like {variable}
        for key, value in parameters.items():
            if not isinstance(value, (dict, list)):  # Don't substitute complex objects directly
                placeholder = f"{{{key}}}"
                content = content.replace(placeholder, str(value))

        return content

    def process(self, context: CompilationContext) -> None:
        """Process template variables, conditionals, and package references."""
        if not context.content:
            return

        content = context.content
        
        # Process package references with prefixes (e.g., @security/prompts/audit)
        if 'imports' in context.dependencies:
            for package_ref, package_info in context.dependencies['imports'].items():
                if isinstance(package_info, dict):
                    prefix = package_info.get('prefix')
                    package_path = package_info.get('path')
                    
                    if prefix and package_path:
                        # Replace references like @security/prompts/audit with actual content
                        # Pattern: @prefix/path/to/resource
                        import re
                        pattern = re.compile(f'@{re.escape(prefix)}/([^\\s]+)')
                        
                        def replace_ref(match):
                            resource_path = match.group(1)
                            # Load the actual file from the package
                            from pathlib import Path
                            
                            # Try different extensions
                            possible_files = [
                                Path(package_path) / resource_path,
                                Path(package_path) / f"{resource_path}.prmd",
                                Path(package_path) / f"{resource_path}.md",
                                Path(package_path) / f"{resource_path}.txt",
                            ]
                            
                            for file_path in possible_files:
                                if file_path.exists():
                                    try:
                                        content_data = file_path.read_text(encoding='utf-8')
                                        
                                        # If it's a .prmd file, parse and extract content
                                        if file_path.suffix == '.prmd':
                                            from .parser import PrompdParser
                                            parser = PrompdParser()
                                            try:
                                                parsed = parser.parse(content_data)
                                                # Return just the content part, not metadata
                                                return parsed.content or f"# Content from @{prefix}/{resource_path}"
                                            except:
                                                # If parsing fails, return raw content
                                                return content_data
                                        else:
                                            # For other files, return as-is
                                            return content_data
                                    except Exception as e:
                                        if context.verbose:
                                            print(f"Warning: Failed to load {file_path}: {e}")
                                        return f"[Error loading @{prefix}/{resource_path}]"
                            
                            # File not found
                            if context.verbose:
                                print(f"Warning: Could not find @{prefix}/{resource_path} in {package_path}")
                            return f"[Not found: @{prefix}/{resource_path}]"
                        
                        content = pattern.sub(replace_ref, content)
        
        # Process inheritance with section-aware override support
        if 'inherits' in context.dependencies:
            parent_path = context.dependencies['inherits']

            try:
                from pathlib import Path
                from .parser import PrompdParser

                parser = PrompdParser()
                parent_file = None

                # Check if it's a direct file path
                parent_path_obj = Path(parent_path)
                if parent_path_obj.suffix == '.prmd' and parent_path_obj.exists():
                    # Direct file path
                    parent_file = parent_path_obj
                elif parent_path_obj.is_dir():
                    # Package directory - find main .prmd file
                    prompd_files = list(parent_path_obj.glob('*.prmd'))

                    if prompd_files:
                        # Use the first .prmd file or look for main.prmd
                        for f in prompd_files:
                            if f.name == 'main.prmd':
                                parent_file = f
                                break
                        if not parent_file:
                            parent_file = prompd_files[0]


                if parent_file:
                    # Parse parent file
                    parent_data = parser.parse_file(parent_file)

                    # Get overrides from child metadata
                    overrides = {}
                    if context.metadata and hasattr(context.metadata, 'override'):
                        overrides = context.metadata.override or {}

                    # Process content with section-aware merging
                    if parent_data.content or context.content:
                        if overrides:
                            # Section-aware override processing
                            try:
                                # Extract sections from parent and child
                                parent_sections = {}
                                child_sections = {}

                                if parent_data.content:
                                    parent_sections = self.section_processor.extract_sections(parent_data.content)

                                if context.content:
                                    child_sections = self.section_processor.extract_sections(context.content)

                                # Determine base directory for resolving override files
                                base_dir = context.source_file.parent if context.source_file else Path.cwd()

                                # Apply overrides and merge content
                                merged_content = self.section_processor.apply_overrides(
                                    parent_sections=parent_sections,
                                    child_sections=child_sections,
                                    overrides=overrides,
                                    base_dir=base_dir,
                                    verbose=context.verbose
                                )

                                context.content = merged_content
                                content = context.content

                                if context.verbose:
                                    print(f"Applied {len(overrides)} section overrides from parent: {parent_path}")

                            except Exception as e:
                                # Fallback to simple concatenation on error
                                context.warnings.append(f"Section override processing failed, using simple inheritance: {e}")
                                if parent_data.content:
                                    if context.content:
                                        context.content = parent_data.content + "\n\n" + context.content
                                    else:
                                        context.content = parent_data.content
                                    content = context.content
                        else:
                            # No overrides - use simple concatenation (backward compatibility)
                            if parent_data.content:
                                if context.content:
                                    context.content = parent_data.content + "\n\n" + context.content
                                else:
                                    context.content = parent_data.content
                                content = context.content

                    # Merge parent parameters (child parameters override)
                    if parent_data.metadata and parent_data.metadata.parameters:
                        for parent_param in parent_data.metadata.parameters:
                            # Only add parent parameter if not defined in child
                            param_exists = False
                            if context.metadata and context.metadata.parameters:
                                for child_param in context.metadata.parameters:
                                    if child_param.name == parent_param.name:
                                        param_exists = True
                                        break

                            if not param_exists:
                                # Add parent parameter to child
                                if context.metadata and hasattr(context.metadata, 'parameters'):
                                    if context.metadata.parameters is None:
                                        context.metadata.parameters = []
                                    context.metadata.parameters.append(parent_param)

                    if context.verbose:
                        print(f"Template inherits from: {parent_path} (loaded {parent_file.name})")

            except Exception as e:
                context.warnings.append(f"Failed to process inheritance from {parent_path}: {e}")
                if context.verbose:
                    print(f"Warning: Could not inherit from {parent_path}: {e}")
        
        # Process templates with both Handlebars/Jinja2 control structures and variable substitution
        if content:
            try:
                from jinja2 import Environment, Template, TemplateSyntaxError

                # First, try to convert Handlebars syntax to Jinja2 for broader compatibility
                converted_content = self._convert_handlebars_to_jinja2(content)
                if converted_content != content and context.verbose:
                    context.warnings.append("Converted Handlebars syntax to Jinja2 for processing")

                # Configure Jinja2 to use single braces for variables
                env = Environment(
                    variable_start_string='{',
                    variable_end_string='}',
                    block_start_string='{%',
                    block_end_string='%}',
                    comment_start_string='{#',
                    comment_end_string='#}'
                )

                # Create template and render with parameters
                template = env.from_string(converted_content)
                content = template.render(**context.parameters)
            except TemplateSyntaxError as e:
                # If Jinja2 fails, fall back to enhanced simple substitution
                context.warnings.append(f"Jinja2 template error, using simple substitution: {e}")
                content = self._enhanced_simple_substitution(content, context.parameters)
            except Exception as e:
                # For any other error, use simple substitution
                context.warnings.append(f"Template processing error, using simple substitution: {e}")
                content = self._enhanced_simple_substitution(content, context.parameters)

        context.content = content
    
    def get_name(self) -> str:
        return "Template Processing"


class CodeGenerationStage(CompilerStage):
    """Generate output in the target format."""
    
    def __init__(self, formatters: Optional[Dict[str, 'OutputFormatter']] = None):
        self.formatters = formatters or {}
        # Register default formatters
        self.register_formatter("markdown", MarkdownFormatter())
        self.register_formatter("provider-json:openai", OpenAIFormatter())
        self.register_formatter("provider-json:anthropic", AnthropicFormatter())
    
    def register_formatter(self, name: str, formatter: 'OutputFormatter'):
        """Register a new output formatter."""
        self.formatters[name] = formatter
    
    def process(self, context: CompilationContext) -> None:
        """Generate the final output in the requested format."""
        format_name = context.output_format
        
        # Handle --to-markdown as just "markdown"
        if format_name.startswith("to-"):
            format_name = format_name[3:]
        
        formatter = self.formatters.get(format_name)
        if not formatter:
            context.errors.append(f"Unknown output format: {format_name}")
            return
        
        try:
            compiled = CompiledPrompt(
                metadata=context.metadata,
                content=context.content,
                contexts=context.contexts,
                parameters=context.parameters,
                verbose=context.verbose
            )
            context.compiled_result = formatter.format(compiled)
        except Exception as e:
            context.errors.append(f"Code generation failed: {e}")
    
    def get_name(self) -> str:
        return "Code Generation"


@dataclass
class CompiledPrompt:
    """Represents a compiled prompt ready for formatting."""
    metadata: Optional[PrompdMetadata]
    content: Optional[str]
    contexts: List[str]
    parameters: Dict[str, Any]
    verbose: bool = False  # Controls metadata inclusion in output


class OutputFormatter(Protocol):
    """Protocol for output format plugins."""
    name: str
    file_extension: str
    mime_type: str
    
    def format(self, compiled: CompiledPrompt) -> Union[str, bytes]:
        """Format the compiled prompt into the target format."""
        ...


class MarkdownFormatter:
    """Default markdown output formatter."""
    name = "markdown"
    file_extension = ".md"
    mime_type = "text/markdown"
    
    def format(self, compiled: CompiledPrompt) -> str:
        """Format as human-readable markdown."""
        output = []

        # Add metadata as YAML frontmatter comment (only in verbose mode)
        if compiled.verbose and compiled.metadata:
            output.append("<!-- PROMPD METADATA")
            # Create clean dictionary with string representations
            clean_metadata = self._clean_metadata_for_display(compiled.metadata.dict())
            output.append(yaml.dump(clean_metadata, default_flow_style=False))
            output.append("-->")
            output.append("")

        # Add extracted contexts as sections
        if compiled.contexts:
            output.append("# Extracted Context Files")
            output.append("")
            for ctx in compiled.contexts:
                output.append(ctx)
                output.append("")

        # Add main content (clean output without "Main Prompt Content" header by default)
        if compiled.content:
            if compiled.verbose:
                output.append("# Main Prompt Content")
                output.append("")
            output.append(compiled.content)

        return "\n".join(output)
    
    def _clean_metadata_for_display(self, metadata_dict):
        """Clean metadata dictionary for YAML display, converting enums to strings."""
        if isinstance(metadata_dict, dict):
            cleaned = {}
            for key, value in metadata_dict.items():
                cleaned[key] = self._clean_metadata_for_display(value)
            return cleaned
        elif isinstance(metadata_dict, list):
            return [self._clean_metadata_for_display(item) for item in metadata_dict]
        elif hasattr(metadata_dict, 'value'):
            # Enum object - return its string value
            return metadata_dict.value
        elif hasattr(metadata_dict, '__str__') and hasattr(metadata_dict, '__class__'):
            # Check if it's a Pydantic model or enum by looking for specific attributes
            if 'ParameterType' in str(type(metadata_dict)):
                return str(metadata_dict)
            return metadata_dict
        else:
            return metadata_dict


class OpenAIFormatter:
    """OpenAI API JSON formatter."""
    name = "provider-json:openai"
    file_extension = ".json"
    mime_type = "application/json"
    
    def format(self, compiled: CompiledPrompt) -> str:
        """Format for OpenAI API."""
        messages = []
        
        # Extract system message if present
        if compiled.content and "## System" in compiled.content:
            # Simple extraction - TODO: improve parsing
            lines = compiled.content.split("\n")
            in_system = False
            system_content = []
            for line in lines:
                if line.strip() == "## System":
                    in_system = True
                    continue
                elif line.startswith("## ") and in_system:
                    break
                elif in_system:
                    system_content.append(line)
            
            if system_content:
                messages.append({
                    "role": "system",
                    "content": "\n".join(system_content).strip()
                })
        
        # Add user message
        messages.append({
            "role": "user",
            "content": compiled.content or ""
        })
        
        api_request = {
            "model": "gpt-4",
            "messages": messages,
            "temperature": 0.1
        }
        
        return json.dumps(api_request, indent=2)


class AnthropicFormatter:
    """Anthropic Claude API JSON formatter."""
    name = "provider-json:anthropic"
    file_extension = ".json"
    mime_type = "application/json"
    
    def format(self, compiled: CompiledPrompt) -> str:
        """Format for Anthropic API."""
        system_message = None
        user_message = compiled.content or ""
        
        # Extract system message if present
        if compiled.content and "## System" in compiled.content:
            lines = compiled.content.split("\n")
            in_system = False
            system_content = []
            for line in lines:
                if line.strip() == "## System":
                    in_system = True
                    continue
                elif line.startswith("## ") and in_system:
                    break
                elif in_system:
                    system_content.append(line)
            
            if system_content:
                system_message = "\n".join(system_content).strip()
        
        api_request = {
            "model": "claude-3-sonnet-20240229",
            "system": system_message,
            "messages": [
                {
                    "role": "user",
                    "content": user_message
                }
            ]
        }
        
        return json.dumps(api_request, indent=2)


class CompilerPipeline:
    """The main compiler pipeline orchestrator."""
    
    def __init__(self, stages: Optional[List[CompilerStage]] = None):
        self.stages = stages or self._default_stages()
    
    def _default_stages(self) -> List[CompilerStage]:
        """Create the default compilation pipeline."""
        return [
            LexicalAnalysisStage(),
            DependencyResolutionStage(),
            SemanticAnalysisStage(),
            AssetExtractionStage(),
            FileValidationStage(),
            TemplateProcessingStage(),
            CodeGenerationStage()
        ]
    
    def execute(self, source: Union[str, Path], **options) -> CompilationContext:
        """Execute the compilation pipeline."""
        # Handle package references vs file paths
        if isinstance(source, str) and source.startswith('@'):
            # This is a package reference, resolve it
            from .package_resolver import package_resolver
            try:
                package_path = package_resolver.resolve_package(source)
                # Find the main .prmd file in the package
                prompd_files = list(package_path.glob('**/*.prmd'))
                if not prompd_files:
                    raise PrompdError(f"No .prmd files found in package: {source}")
                # Use the first .prmd file found (or could be specified in manifest)
                source_path = prompd_files[0]
            except Exception as e:
                raise PrompdError(f"Failed to resolve package {source}: {e}")
        else:
            source_path = Path(source) if isinstance(source, str) else source
        
        context = CompilationContext(
            source_file=source_path,
            output_format=options.get('output_format', 'markdown'),
            parameters=options.get('parameters', {}),
            verbose=options.get('verbose', False)
        )
        
        # Run each stage
        for stage in self.stages:
            if context.errors:
                break  # Stop on first error
            stage.process(context)
        
        return context


class PrompdCompiler:
    """High-level compiler interface."""
    
    def __init__(self):
        self.pipeline = CompilerPipeline()
    
    def compile(
        self,
        source: Union[str, Path],
        output_format: str = "markdown",
        parameters: Optional[Dict[str, Any]] = None,
        output_file: Optional[Path] = None,
        verbose: bool = False
    ) -> Union[str, bytes]:
        """
        Compile a .prmd file to the specified format.
        
        Args:
            source: Path to .prmd file or package reference
            output_format: Target format (markdown, provider-json:openai, etc.)
            parameters: Parameters to substitute
            output_file: Optional output file path
            
        Returns:
            Compiled content as string or bytes
            
        Raises:
            PrompdError: If compilation fails
        """
        context = self.pipeline.execute(
            source,
            output_format=output_format,
            parameters=parameters or {},
            verbose=verbose
        )
        
        if context.errors:
            raise PrompdError(f"Compilation failed: {', '.join(context.errors)}")
        
        if context.warnings:
            for warning in context.warnings:
                print(f"Warning: {warning}")
        
        result = context.compiled_result
        
        if output_file and result:
            output_path = Path(output_file)
            if isinstance(result, bytes):
                output_path.write_bytes(result)
            else:
                output_path.write_text(result, encoding='utf-8')
        
        return result or ""