"""Security utilities for input validation and path sanitization."""

import os
import re
from pathlib import Path
from typing import Union
from .exceptions import PrompdError


class SecurityError(PrompdError):
    """Raised when security validation fails."""
    pass


def validate_file_path(file_path: Union[str, Path], allow_absolute: bool = False) -> Path:
    """
    Validate and sanitize file paths to prevent path traversal attacks.
    
    Args:
        file_path: The file path to validate
        allow_absolute: Whether to allow absolute paths
        
    Returns:
        Validated Path object
        
    Raises:
        SecurityError: If path is invalid or potentially dangerous
    """
    if isinstance(file_path, str):
        path = Path(file_path)
    else:
        path = file_path
    
    # Convert to string for validation
    path_str = str(path)
    
    # Check for path traversal attempts
    dangerous_patterns = [
        '..',       # Parent directory traversal
        '~',        # Home directory expansion
        '$',        # Environment variable expansion
    ]
    
    for pattern in dangerous_patterns:
        if pattern in path_str:
            raise SecurityError(f"Potentially dangerous path component '{pattern}' found in: {path_str}")
    
    # Normalize the path to resolve any remaining traversals
    try:
        normalized = path.resolve()
    except (OSError, RuntimeError) as e:
        raise SecurityError(f"Failed to resolve path '{path_str}': {e}")
    
    # Check if it's absolute when not allowed
    if not allow_absolute and normalized.is_absolute():
        # Allow if it's within the current working directory
        cwd = Path.cwd()
        try:
            normalized.relative_to(cwd)
        except ValueError:
            raise SecurityError(f"Absolute path outside current directory not allowed: {normalized}")
    
    return normalized


def validate_git_file_path(file_path: Union[str, Path]) -> str:
    """
    Validate file paths specifically for Git operations.
    
    Args:
        file_path: File path to validate for Git commands
        
    Returns:
        Safe file path as string
        
    Raises:
        SecurityError: If path is unsafe for Git operations
    """
    validated_path = validate_file_path(file_path, allow_absolute=False)
    
    # Additional Git-specific validation
    path_str = str(validated_path)
    
    # Ensure it's a reasonable file extension for prompd
    if not (path_str.endswith('.prmd') or path_str.endswith('.prompd') or 
            path_str.endswith('.pdflow') or path_str.endswith('.json') or
            path_str.endswith('.yaml') or path_str.endswith('.yml')):
        # Allow it but log warning for non-standard extensions
        pass
    
    # Prevent command injection through filenames
    dangerous_chars = [';', '&', '|', '`', '$', '(', ')', '<', '>', '"', "'"]
    for char in dangerous_chars:
        if char in path_str:
            raise SecurityError(f"Potentially dangerous character '{char}' in filename: {path_str}")
    
    return path_str


def validate_git_message(message: str) -> str:
    """
    Validate Git commit messages for safety.
    
    Args:
        message: The commit message to validate
        
    Returns:
        Safe commit message
        
    Raises:
        SecurityError: If message contains dangerous content
    """
    if not message or not message.strip():
        raise SecurityError("Commit message cannot be empty")
    
    # Check message length (Git has practical limits)
    if len(message) > 2000:
        raise SecurityError("Commit message too long (max 2000 characters)")
    
    # Check for command injection attempts in commit message
    dangerous_patterns = [
        '$(', '`', '${', '#!/', '&>', '|>', '<(', '>('
    ]
    
    for pattern in dangerous_patterns:
        if pattern in message:
            raise SecurityError(f"Potentially dangerous pattern '{pattern}' in commit message")
    
    return message.strip()


def validate_version_string(version: str) -> str:
    """
    Validate semantic version strings.
    
    Args:
        version: Version string to validate
        
    Returns:
        Validated version string
        
    Raises:
        SecurityError: If version format is invalid
    """
    # Semantic version pattern (major.minor.patch with optional pre-release/build)
    version_pattern = r'^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
    
    if not re.match(version_pattern, version):
        raise SecurityError(f"Invalid semantic version format: {version}")
    
    # Check for reasonable version numbers
    parts = version.split('.', 3)
    for i, part in enumerate(parts[:3]):
        try:
            num = int(part)
            if num < 0 or num > 999:
                raise SecurityError(f"Version component out of range (0-999): {num}")
        except ValueError:
            raise SecurityError(f"Invalid version component: {part}")
    
    return version