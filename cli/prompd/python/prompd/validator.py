"""PMD validation system."""

import re
from pathlib import Path
from typing import Dict, Any, List, Optional

import jsonschema

from prompd.parser import PrompdParser
from prompd.exceptions import ValidationError


class PrompDValidator:
    """Validator for .prompd files and parameters."""
    
    def __init__(self):
        self.parser = PrompdParser()
    
    def validate_file(self, file_path: Path) -> List[Dict[str, Any]]:
        """
        Validate a .prompd file structure and content.
        
        Args:
            file_path: Path to .prompd file
            
        Returns:
            List of validation issues (empty if valid)
        """
        issues = []
        
        try:
            prompd = self.parser.parse_file(file_path)
            metadata = prompd.metadata
            content = prompd.content
        except Exception as e:
            return [{"level": "error", "message": f"Failed to parse file: {e}"}]
        
        # Validate metadata structure
        issues.extend(self._validate_metadata(metadata))
        
        # Validate variable references
        issues.extend(self._validate_variable_references(metadata, content))
        
        # Validate variable definitions
        for var in metadata.parameters:
            issues.extend(self._validate_variable_definition(var))
        
        return issues
    
    def validate_parameters(self, metadata: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        """
        Validate parameters against PMD metadata.
        
        Args:
            metadata: PMD metadata with variable definitions
            parameters: User-provided parameters
            
        Raises:
            ValidationError: If parameters are invalid
        """
        variables = metadata.get("variables", [])
        var_map = {var["name"]: var for var in variables}
        
        # Check required parameters
        for var in variables:
            if var.get("required", False) and var["name"] not in parameters:
                if "default" not in var:
                    raise ValidationError(
                        f"Required parameter '{var['name']}' not provided"
                    )
        
        # Validate provided parameters
        for name, value in parameters.items():
            if name not in var_map:
                # Allow unknown parameters with warning
                continue
            
            var_def = var_map[name]
            self._validate_parameter_value(name, value, var_def)
    
    def _validate_metadata(self, metadata) -> List[Dict[str, Any]]:
        """Validate .prompd metadata structure."""
        issues = []
        
        # Check required fields
        if not metadata.name:
            issues.append({
                "level": "error",
                "message": "Missing required field 'name'"
            })
        elif not re.match(r'^[a-z0-9-]+$', metadata.name):
            issues.append({
                "level": "warning",
                "message": f"Name '{metadata.name}' should use kebab-case (lowercase with hyphens)"
            })
        
        if not metadata.description:
            issues.append({
                "level": "warning",
                "message": "Missing recommended field 'description'"
            })
        
        # Enhanced version validation
        if metadata.version:
            version_issues = self._validate_version(metadata.version)
            issues.extend(version_issues)
        else:
            issues.append({
                "level": "info",
                "message": "No version specified - consider adding semantic version for tracking"
            })
        
        return issues
    
    def _validate_variable_references(self, metadata, content: str) -> List[Dict[str, Any]]:
        """Check that all variable references in content are defined."""
        issues = []
        
        # Get defined variables
        defined_vars = set()
        for var in metadata.parameters:
            defined_vars.add(var.name)
        
        # Add inputs fields if defined
        if metadata.inputs:
            for key in metadata.inputs:
                defined_vars.add(f"inputs.{key}")
        
        # Extract referenced variables
        referenced_vars = self.parser.extract_variables(content)
        
        # Check for undefined variables
        for var in referenced_vars:
            if var not in defined_vars and not var.startswith("inputs."):
                issues.append({
                    "level": "error",
                    "message": f"Undefined variable '{var}' referenced in content"
                })
        
        return issues
    
    def _validate_variable_definition(self, var_def) -> List[Dict[str, Any]]:
        """Validate a single variable definition."""
        issues = []
        
        # Check name format
        if not re.match(r'^[a-z_][a-z0-9_]*$', var_def.name):
            issues.append({
                "level": "warning",
                "message": f"Variable name '{var_def.name}' should use snake_case"
            })
        
        # Validate pattern for string type
        if var_def.pattern:
            if var_def.type.value != "string":
                issues.append({
                    "level": "warning",
                    "message": f"Pattern validation only applies to string type (variable: {var_def.name})"
                })
            else:
                try:
                    re.compile(var_def.pattern)
                except re.error as e:
                    issues.append({
                        "level": "error",
                        "message": f"Invalid regex pattern for variable '{var_def.name}': {e}"
                    })
        
        # Validate min/max for numeric types
        if var_def.min_value is not None or var_def.max_value is not None:
            if var_def.type.value not in ["integer", "float"]:
                issues.append({
                    "level": "warning",
                    "message": f"Min/max validation only applies to numeric types (variable: {var_def.name})"
                })
        
        return issues
    
    def _validate_version(self, version: str) -> List[Dict[str, Any]]:
        """Comprehensive version validation."""
        issues = []
        
        # Basic semantic version format
        if not re.match(r'^\d+\.\d+\.\d+$', version):
            issues.append({
                "level": "error",
                "message": f"Version '{version}' must follow semantic versioning format (x.y.z)"
            })
            return issues
        
        # Parse version components
        major, minor, patch = map(int, version.split('.'))
        
        # Check for unreasonable version numbers
        if major > 100:
            issues.append({
                "level": "warning", 
                "message": f"Major version {major} seems unusually high - verify correctness"
            })
        
        if minor > 100:
            issues.append({
                "level": "warning",
                "message": f"Minor version {minor} seems unusually high - verify correctness"
            })
        
        if patch > 1000:
            issues.append({
                "level": "warning",
                "message": f"Patch version {patch} seems unusually high - verify correctness"
            })
        
        # Check for development indicators
        if major == 0:
            issues.append({
                "level": "info",
                "message": "Version 0.x.x indicates pre-release/development stage"
            })
        
        return issues
    
    def validate_version_consistency(self, file_path: Path, check_git: bool = False) -> List[Dict[str, Any]]:
        """Validate version consistency across file and git history."""
        issues = []
        
        try:
            prompd = self.parser.parse_file(file_path)
            file_version = prompd.metadata.version
            
            if not file_version:
                issues.append({
                    "level": "warning",
                    "message": "No version in file - cannot check consistency"
                })
                return issues
            
            if check_git:
                git_issues = self._validate_git_consistency(file_path, file_version)
                issues.extend(git_issues)
                
        except Exception as e:
            issues.append({
                "level": "error", 
                "message": f"Failed to validate version consistency: {e}"
            })
        
        return issues
    
    def _validate_git_consistency(self, file_path: Path, file_version: str) -> List[Dict[str, Any]]:
        """Check version consistency with git history."""
        import subprocess
        issues = []
        
        try:
            # Get latest git tag for this file
            result = subprocess.run([
                "git", "log", "--tags", "--simplify-by-decoration", 
                "--pretty=format:%d", "-n", "1", "--", str(file_path)
            ], capture_output=True, text=True, check=False)
            
            if result.returncode == 0 and result.stdout.strip():
                # Extract tag name
                tag_line = result.stdout.strip()
                tag_match = re.search(r'tag: ([^,)]+)', tag_line)
                if tag_match:
                    latest_tag = tag_match.group(1).strip()
                    
                    # Expected tag format: filename-vX.Y.Z
                    expected_tag = f"{file_path.stem}-v{file_version}"
                    
                    if latest_tag != expected_tag:
                        issues.append({
                            "level": "warning",
                            "message": f"Version mismatch: file has {file_version}, latest git tag is {latest_tag}"
                        })
            
            # Check if current version already exists as tag
            tag_check = subprocess.run([
                "git", "tag", "-l", f"{file_path.stem}-v{file_version}"
            ], capture_output=True, text=True, check=False)
            
            if tag_check.returncode == 0 and tag_check.stdout.strip():
                issues.append({
                    "level": "error",
                    "message": f"Version {file_version} already exists as git tag - consider bumping version"
                })
                
        except Exception as e:
            issues.append({
                "level": "info",
                "message": f"Could not check git history: {e}"
            })
        
        return issues
    
    def suggest_version_bump(self, current_version: str, changes_summary: str = "") -> Dict[str, Any]:
        """Suggest appropriate version bump based on changes."""
        major, minor, patch = map(int, current_version.split('.'))
        
        suggestions = {
            "current": current_version,
            "patch": f"{major}.{minor}.{patch + 1}",
            "minor": f"{major}.{minor + 1}.0", 
            "major": f"{major + 1}.0.0"
        }
        
        # Simple heuristics based on changes
        recommended = "patch"  # Default
        
        if any(keyword in changes_summary.lower() for keyword in 
               ["breaking", "incompatible", "major", "remove", "delete"]):
            recommended = "major"
        elif any(keyword in changes_summary.lower() for keyword in
                ["feature", "add", "new", "minor", "enhance"]):
            recommended = "minor"
        
        return {
            "suggestions": suggestions,
            "recommended": recommended,
            "reason": f"Based on changes: {changes_summary}" if changes_summary else "Default patch bump"
        }
    
    def _validate_parameter_value(self, name: str, value: Any, var_def: Dict[str, Any]) -> None:
        """
        Validate a parameter value against its definition.
        
        Args:
            name: Parameter name
            value: Parameter value
            var_def: Variable definition from metadata
            
        Raises:
            ValidationError: If value is invalid
        """
        var_type = var_def.get("type", "string")
        
        # Type validation
        if var_type == "integer":
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise ValidationError(f"Parameter '{name}' must be an integer")
            
            # Range validation
            if "min" in var_def and value < var_def["min"]:
                raise ValidationError(
                    f"Parameter '{name}' value {value} is below minimum {var_def['min']}"
                )
            if "max" in var_def and value > var_def["max"]:
                raise ValidationError(
                    f"Parameter '{name}' value {value} is above maximum {var_def['max']}"
                )
        
        elif var_type == "float":
            try:
                value = float(value)
            except (TypeError, ValueError):
                raise ValidationError(f"Parameter '{name}' must be a float")
            
            # Range validation
            if "min" in var_def and value < var_def["min"]:
                raise ValidationError(
                    f"Parameter '{name}' value {value} is below minimum {var_def['min']}"
                )
            if "max" in var_def and value > var_def["max"]:
                raise ValidationError(
                    f"Parameter '{name}' value {value} is above maximum {var_def['max']}"
                )
        
        elif var_type == "boolean":
            if str(value).lower() not in ["true", "false", "yes", "no", "1", "0"]:
                raise ValidationError(f"Parameter '{name}' must be a boolean")
        
        elif var_type == "string":
            value = str(value)
            
            # Pattern validation
            if "pattern" in var_def:
                if not re.match(var_def["pattern"], value):
                    error_msg = var_def.get(
                        "error_message",
                        f"Parameter '{name}' does not match required pattern: {var_def['pattern']}"
                    )
                    raise ValidationError(error_msg)
        
        elif var_type == "array":
            if not isinstance(value, (list, tuple)):
                # Try to parse as comma-separated string
                if isinstance(value, str):
                    value = [v.strip() for v in value.split(",")]
                else:
                    raise ValidationError(f"Parameter '{name}' must be an array")
        
        elif var_type == "object":
            if not isinstance(value, dict):
                raise ValidationError(f"Parameter '{name}' must be an object")