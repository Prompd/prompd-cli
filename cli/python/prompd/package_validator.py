"""
Package validation for .prmd and .pdpkg formats.

Validates packages according to Registry specifications and ensures
compatibility with the Prompd ecosystem.
"""

import json
import os
import re
import yaml
import zipfile
from pathlib import Path
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

from .parser import PrompdParser
from .validator import PrompdValidator


def _serialize_for_validation(obj):
    """Convert Python objects to JSON-serializable format for validation."""
    if hasattr(obj, '__dict__'):
        # Convert dataclass/object to dict
        result = {}
        for key, value in obj.__dict__.items():
            if not key.startswith('_'):  # Skip private attributes
                result[key] = _serialize_for_validation(value)
        return result
    elif hasattr(obj, 'value') and hasattr(obj, 'name'):  # Enum-like objects
        return obj.value if hasattr(obj.value, 'lower') else str(obj.value)
    elif isinstance(obj, list):
        return [_serialize_for_validation(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: _serialize_for_validation(value) for key, value in obj.items()}
    elif isinstance(obj, (str, int, float, bool, type(None))):
        return obj
    else:
        # For any other object, try to convert to string as fallback
        return str(obj)


@dataclass
class ValidationResult:
    """Result of package validation."""
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    package_info: Optional[Dict[str, Any]] = None


class PackageValidator:
    """Validates .prmd files and .pdpkg packages."""
    
    def __init__(self):
        self.parser = PrompdParser()
        self.prmd_validator = PrompdValidator()
    
    def validate_prompd_package(self, file_path: Path) -> ValidationResult:
        """Validate a single .prmd file as a package."""
        errors = []
        warnings = []
        package_info = None
        
        try:
            # Parse the .prmd file
            parsed = self.parser.parse_file(str(file_path))
            package_info = parsed.metadata
            
            # Validate basic .prmd structure
            validation_issues = self.prmd_validator.validate_file(file_path)
            for issue in validation_issues:
                if issue.get('level') == 'error':
                    errors.append(issue.get('message', 'Unknown validation error'))
                else:
                    warnings.append(issue.get('message', 'Unknown validation warning'))
            
            # Convert metadata to dict for validation - serialize all fields to ensure JSON compatibility
            metadata_dict = _serialize_for_validation({
                'name': package_info.name,
                'description': package_info.description,
                'version': package_info.version,
                'author': getattr(package_info, 'author', None),
                'license': getattr(package_info, 'license', None),
                'homepage': getattr(package_info, 'homepage', None),
                'repository': getattr(package_info, 'repository', None),
                'tags': getattr(package_info, 'tags', []),
                'parameters': package_info.parameters or [],
                'dependencies': getattr(package_info, 'dependencies', {}),
                'type': getattr(package_info, 'type', None),
                'runtime': getattr(package_info, 'runtime', None),
                'examples': getattr(package_info, 'examples', [])
            })
            
            # Validate package-specific fields
            self._validate_package_metadata(metadata_dict, errors, warnings)
            
            # Validate content structure - skip if we get errors above
            if len(errors) == 0 or not any('Failed to parse' in err for err in errors):
                try:
                    self._validate_content_structure({'content': parsed.content, 'metadata': metadata_dict}, errors, warnings)
                except Exception as content_err:
                    errors.append(f"Content validation error: {content_err}")
            
        except Exception as e:
            errors.append(f"Failed to parse .prmd file: {e}")
            import traceback
            errors.append(f"Traceback: {traceback.format_exc()}")
        
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            package_info=metadata_dict if 'metadata_dict' in locals() else None
        )
    
    def validate_pdpkg_package(self, file_path: Path) -> ValidationResult:
        """Validate a .pdpkg bundle package."""
        errors = []
        warnings = []
        package_info = None
        
        try:
            # Check if it's a valid ZIP file
            if not zipfile.is_zipfile(file_path):
                errors.append("Package file is not a valid ZIP archive")
                return ValidationResult(False, errors, warnings)
            
            with zipfile.ZipFile(file_path, 'r') as zip_file:
                # Validate manifest
                manifest_result = self._validate_manifest(zip_file, errors, warnings)
                if manifest_result:
                    package_info = manifest_result
                
                # Validate package structure
                self._validate_package_structure(zip_file, errors, warnings)
                
                # Validate contained .prmd files
                self._validate_contained_prompd_files(zip_file, errors, warnings)
                
                # Validate file references
                if package_info and 'files' in package_info:
                    self._validate_file_references(zip_file, package_info['files'], errors, warnings)
        
        except Exception as e:
            errors.append(f"Failed to read .pdpkg file: {e}")
        
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            package_info=package_info
        )
    
    def _validate_package_metadata(self, metadata: Dict[str, Any], errors: List[str], warnings: List[str]):
        """Validate package metadata fields."""
        # Required fields
        required_fields = ['name', 'description', 'version']
        for field in required_fields:
            if field not in metadata:
                errors.append(f"Missing required field: {field}")
            elif not metadata[field] or not isinstance(metadata[field], str):
                errors.append(f"Field '{field}' must be a non-empty string")
        
        # Validate package ID format (for registry compatibility)
        if 'id' in metadata:
            if not self._is_valid_package_name(metadata['id']):
                errors.append(f"Invalid package ID format: {metadata['id']}")
        
        # Name field can be human-readable (no format restrictions)
        
        # Validate semantic version
        if 'version' in metadata:
            if not self._is_valid_semver(metadata['version']):
                errors.append(f"Invalid semantic version: {metadata['version']}")
        
        # Validate optional fields
        if 'author' in metadata:
            if not isinstance(metadata['author'], str):
                errors.append("Field 'author' must be a string")
        
        if 'license' in metadata:
            if not isinstance(metadata['license'], str):
                warnings.append("License should be a valid SPDX identifier")
        
        if 'homepage' in metadata and metadata['homepage']:
            if not self._is_valid_url(metadata['homepage']):
                warnings.append("Homepage should be a valid URL")
        
        if 'repository' in metadata and metadata['repository']:
            if not self._is_valid_url(metadata['repository']):
                warnings.append("Repository should be a valid URL")
        
        if 'tags' in metadata:
            if not isinstance(metadata['tags'], list):
                errors.append("Field 'tags' must be an array")
            elif len(metadata['tags']) > 10:
                warnings.append("Too many tags (max 10 recommended)")
        
        # Validate parameters
        if 'parameters' in metadata:
            self._validate_parameters(metadata['parameters'], errors, warnings)
        
        # Validate dependencies
        if 'dependencies' in metadata:
            self._validate_dependencies(metadata['dependencies'], errors, warnings)
    
    def _validate_content_structure(self, parsed: Dict[str, Any], errors: List[str], warnings: List[str]):
        """Validate the content structure of a .prmd file."""
        content = parsed.get('content', '') or ''
        
        if not content.strip():
            errors.append("Package content cannot be empty")
        
        # Check for variable references
        variables = re.findall(r'\{(\w+)\}', content) if content else []
        parameters = parsed.get('metadata', {}).get('parameters', [])
        
        # Get parameter names, handling both dict and object formats
        param_names = set()
        for p in parameters:
            if isinstance(p, dict):
                param_names.add(p.get('name'))
            else:
                # Object with name attribute
                param_names.add(getattr(p, 'name', None))
        
        # Remove None values
        param_names.discard(None)
        
        # Warn about undefined variables
        for var in set(variables):
            if var not in param_names:
                warnings.append(f"Variable '{var}' used in content but not defined in parameters")
    
    def _validate_manifest(self, zip_file: zipfile.ZipFile, errors: List[str], warnings: List[str]) -> Optional[Dict[str, Any]]:
        """Validate the manifest.json file in a .pdpkg package."""
        if 'manifest.json' not in zip_file.namelist():
            errors.append("Package missing required manifest.json file")
            return None
        
        try:
            with zip_file.open('manifest.json') as f:
                manifest = json.loads(f.read().decode('utf-8'))
        except json.JSONDecodeError as e:
            errors.append(f"Invalid manifest.json: {e}")
            return None
        except Exception as e:
            errors.append(f"Failed to read manifest.json: {e}")
            return None
        
        # Validate manifest structure
        self._validate_package_metadata(manifest, errors, warnings)
        
        return manifest
    
    def _validate_package_structure(self, zip_file: zipfile.ZipFile, errors: List[str], warnings: List[str]):
        """Validate the internal structure of a .pdpkg package."""
        file_list = zip_file.namelist()
        
        # SECURITY: Check for ZIP slip/directory traversal attacks
        for file_name in file_list:
            # Normalize path and check for traversal
            normalized_path = os.path.normpath(file_name)
            if '..' in normalized_path or normalized_path.startswith('/') or normalized_path.startswith('\\'):
                errors.append(f"Security violation: Path traversal detected in {file_name}")
            
            # Check for absolute paths (Windows and Unix)
            if os.path.isabs(file_name):
                errors.append(f"Security violation: Absolute path detected in {file_name}")
        
        # Check for common directories
        has_prompts = any(f.startswith('prompts/') or f.endswith('.prmd') for f in file_list)
        has_workflows = any(f.startswith('workflows/') or f.endswith('.pdflow') for f in file_list)
        
        if not has_prompts and not has_workflows:
            warnings.append("Package contains no .prmd or .pdflow files")
        
        # Check for reasonable file count
        if len(file_list) > 100:
            warnings.append(f"Package contains many files ({len(file_list)}), consider optimization")
        
        # Check for suspicious files
        suspicious_extensions = ['.exe', '.dll', '.so', '.bat', '.sh', '.cmd']
        for file_name in file_list:
            if any(file_name.lower().endswith(ext) for ext in suspicious_extensions):
                warnings.append(f"Suspicious file detected: {file_name}")
    
    def _validate_contained_prompd_files(self, zip_file: zipfile.ZipFile, errors: List[str], warnings: List[str]):
        """Validate all .prmd files contained in the package."""
        prompd_files = [f for f in zip_file.namelist() if f.endswith('.prmd')]
        
        for prompd_file in prompd_files:
            try:
                with zip_file.open(prompd_file) as f:
                    content = f.read().decode('utf-8')
                    # Basic validation - could be expanded
                    if not content.strip():
                        errors.append(f"Empty .prmd file: {prompd_file}")
            except Exception as e:
                errors.append(f"Failed to read {prompd_file}: {e}")
    
    def _validate_file_references(self, zip_file: zipfile.ZipFile, file_refs: Dict[str, Any],
                                 errors: List[str], warnings: List[str]):
        """Validate that referenced files exist in the package.

        Note: Some files may be renamed during packaging (e.g., .ts -> .ts.txt) to avoid execution.
        This validator checks for both the original name and common renamed variants.
        """
        file_list = zip_file.namelist()

        def _file_exists_in_package(file_ref: str, file_list: List[str]) -> bool:
            """Check if file exists, including renamed variants (.txt suffix)."""
            # Check original filename
            if file_ref in file_list:
                return True

            # Check if file was renamed with .txt suffix (common for source code files)
            # This happens for files like .ts, .js, .py, etc. during packaging
            txt_variant = f"{file_ref}.txt"
            if txt_variant in file_list:
                return True

            return False

        # Handle both dict format (categorized) and list format (simple array)
        if isinstance(file_refs, dict):
            for category, files in file_refs.items():
                if not isinstance(files, list):
                    continue

                for file_ref in files:
                    if not _file_exists_in_package(file_ref, file_list):
                        errors.append(f"Referenced file not found in package: {file_ref}")
        elif isinstance(file_refs, list):
            # Simple list of file paths
            for file_ref in file_refs:
                if not _file_exists_in_package(file_ref, file_list):
                    errors.append(f"Referenced file not found in package: {file_ref}")
        else:
            errors.append(f"Invalid file references format: expected dict or list, got {type(file_refs)}")
    
    def _validate_parameters(self, parameters: List[Dict[str, Any]], errors: List[str], warnings: List[str]):
        """Validate parameter definitions."""
        if not isinstance(parameters, list):
            errors.append("Parameters must be an array")
            return
        
        if len(parameters) > 50:
            warnings.append("Large number of parameters (>50), consider simplification")
        
        param_names = set()
        for i, param in enumerate(parameters):
            if not isinstance(param, dict):
                errors.append(f"Parameter {i} must be an object")
                continue
            
            # Check required fields
            if 'name' not in param:
                errors.append(f"Parameter {i} missing required 'name' field")
                continue
            
            param_name = param['name']
            if param_name in param_names:
                errors.append(f"Duplicate parameter name: {param_name}")
            param_names.add(param_name)
            
            if 'type' not in param:
                errors.append(f"Parameter '{param_name}' missing required 'type' field")
            
            # Validate parameter type - handle both string and enum types
            param_type = param.get('type')
            if hasattr(param_type, 'value'):  # It's an enum
                param_type = param_type.value.lower()
            
            valid_types = ['string', 'integer', 'float', 'boolean', 'array', 'object', 'file']
            if param_type not in valid_types:
                errors.append(f"Parameter '{param_name}' has invalid type: {param.get('type')}")
    
    def _validate_dependencies(self, dependencies: Dict[str, str], errors: List[str], warnings: List[str]):
        """Validate dependency specifications."""
        if not isinstance(dependencies, dict):
            errors.append("Dependencies must be an object")
            return
        
        for dep_name, version_spec in dependencies.items():
            if not isinstance(version_spec, str):
                errors.append(f"Dependency '{dep_name}' version must be a string")
                continue
            
            # Basic version spec validation (could be more sophisticated)
            if not re.match(r'^[\^~>=<]*\d+\.\d+\.\d+.*$', version_spec):
                warnings.append(f"Dependency '{dep_name}' has unusual version spec: {version_spec}")
    
    def _is_valid_package_name(self, name: str) -> bool:
        """Check if package name follows valid format."""
        # Allow: username/package-name or @scope/package-name or simple package-name
        # Follows npm package name conventions (allows dots in scope names)
        patterns = [
            r'^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_-]+$',  # username/package
            r'^@[a-zA-Z0-9_.-]+/[a-zA-Z0-9_-]+$',  # @scope/package (allows dots in scope)
            r'^[a-zA-Z0-9_-]+$'  # simple package name
        ]
        return any(re.match(pattern, name) for pattern in patterns)
    
    def _is_valid_semver(self, version: str) -> bool:
        """Check if version follows semantic versioning format."""
        semver_pattern = r'^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
        return re.match(semver_pattern, version) is not None
    
    def _is_valid_url(self, url: str) -> bool:
        """Basic URL validation."""
        url_pattern = r'^https?://[^\s/$.?#].[^\s]*$'
        return re.match(url_pattern, url) is not None


def validate_package(file_path: Path) -> ValidationResult:
    """Validate a package file (.prmd or .pdpkg)."""
    validator = PackageValidator()
    
    if file_path.suffix == '.prmd':
        return validator.validate_prompd_package(file_path)
    elif file_path.suffix == '.pdpkg':
        return validator.validate_pdpkg_package(file_path)
    else:
        return ValidationResult(
            is_valid=False,
            errors=[f"Unsupported package format: {file_path.suffix}"],
            warnings=[]
        )