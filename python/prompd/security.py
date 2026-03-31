"""Security utilities for input validation, path sanitization, and secrets detection."""

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Union

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

    # Check for null bytes first (can truncate paths in C-based libraries)
    if "\x00" in path_str:
        raise SecurityError("Null byte detected in file path")

    # Check for path traversal attempts
    dangerous_patterns = [
        "..",  # Parent directory traversal
        "~",  # Home directory expansion
        "$",  # Environment variable expansion
        "`",  # Backtick command substitution
        "{",  # Brace expansion
        "}",  # Brace expansion
        "*",  # Glob wildcard
        "?",  # Glob single character
    ]

    for pattern in dangerous_patterns:
        if pattern in path_str:
            raise SecurityError(f"Potentially dangerous path component '{pattern}' found in: {path_str}")

    # Normalize the path to resolve any remaining traversals
    try:
        normalized = path.resolve()
    except (OSError, RuntimeError) as e:
        raise SecurityError(f"Failed to resolve path '{path_str}': {e}") from e

    # Check if it's absolute when not allowed
    if not allow_absolute and normalized.is_absolute():
        # Allow if it's within the current working directory
        cwd = Path.cwd()
        try:
            normalized.relative_to(cwd)
        except ValueError as e:
            raise SecurityError(f"Absolute path outside current directory not allowed: {normalized}") from e

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
    if not (
        path_str.endswith(".prmd")
        or path_str.endswith(".prompd")
        or path_str.endswith(".pdflow")
        or path_str.endswith(".json")
        or path_str.endswith(".yaml")
        or path_str.endswith(".yml")
    ):
        # Allow it but log warning for non-standard extensions
        pass

    # Prevent command injection through filenames
    dangerous_chars = [";", "&", "|", "`", "$", "(", ")", "<", ">", '"', "'"]
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
    dangerous_patterns = ["$(", "`", "${", "#!/", "&>", "|>", "<(", ">("]

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
    version_pattern = (
        r"^(\d+)\.(\d+)\.(\d+)"
        r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
        r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
    )

    if not re.match(version_pattern, version):
        raise SecurityError(f"Invalid semantic version format: {version}")

    # Check for reasonable version numbers
    parts = version.split(".", 3)
    for _i, part in enumerate(parts[:3]):
        try:
            num = int(part)
            if num < 0 or num > 999:
                raise SecurityError(f"Version component out of range (0-999): {num}")
        except ValueError as e:
            raise SecurityError(f"Invalid version component: {part}") from e

    return version


# --- Secrets Detection ---

@dataclass
class SecretMatch:
    """Represents a detected secret in content or a file."""

    secret_type: str
    line: int
    masked_value: str
    file_path: str = ""


# Compiled patterns for detecting various types of secrets.
# Matches the Go CLI implementation in security.go for cross-platform consistency.
SECRET_PATTERNS: Dict[str, re.Pattern[str]] = {
    "OpenAI API Key": re.compile(r"sk-[a-zA-Z0-9]{20,}"),
    "Anthropic API Key": re.compile(r"sk-ant-[a-zA-Z0-9_-]{20,}"),
    "AWS Access Key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "AWS Secret Key": re.compile(
        r"(?i)aws[_-]?secret[_-]?access[_-]?key[=:\s]+['\"]?[a-zA-Z0-9/+=]{40}['\"]?"
    ),
    "GitHub Token": re.compile(r"gh[ps]_[a-zA-Z0-9]{36}"),
    "GitHub Fine-Grained": re.compile(r"github_pat_[a-zA-Z0-9_]{22,}"),
    "Prompd Registry Token": re.compile(r"prompd_[a-zA-Z0-9]{32,}"),
    "Private Key": re.compile(
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"
    ),
    "Generic API Key": re.compile(
        r"(?i)(?:api[_-]?key|apikey|api_secret|apisecret)[_-]?[=:]\s*['\"]?([a-zA-Z0-9_\-]{20,})['\"]?"
    ),
    "Generic Secret": re.compile(
        r"(?i)(?:secret|password|passwd|token)[_-]?[=:]\s*['\"]?([a-zA-Z0-9_\-!@#$%^&*]{16,})['\"]?"
    ),
    "Bearer Token": re.compile(r"[Bb]earer\s+[a-zA-Z0-9_\-.]{32,256}"),
    "JWT Token": re.compile(
        r"eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}"
    ),
    "URL-Embedded Credentials": re.compile(
        r"https?://[^:\s]+:[^@\s]+@[a-zA-Z0-9.-]+"
    ),
    "Slack Token": re.compile(r"xox[bpors]-[a-zA-Z0-9-]{10,}"),
    "Google API Key": re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    "Stripe Key": re.compile(r"(?:sk|pk)_(?:test|live)_[a-zA-Z0-9]{20,}"),
}

# File extensions considered as text files for secrets scanning
_TEXT_EXTENSIONS = {
    ".prmd", ".pdproj", ".yaml", ".yml", ".json", ".md", ".txt",
    ".py", ".go", ".js", ".ts", ".tsx", ".jsx", ".sh", ".bat",
    ".env", ".html", ".css", ".xml", ".toml", ".ini", ".conf",
    ".c", ".cpp", ".h", ".hpp", ".java", ".cs", ".rb", ".php",
    ".sql", ".r", ".lua", ".pl", ".swift", ".kt", ".rs",
}

# Files that commonly contain secrets and should be excluded from packaging
_SECRET_FILE_NAMES = {
    ".env", ".env.local", ".env.production", ".env.development",
    ".env.test", "credentials.json", "secrets.yaml", "secrets.yml",
    "private.key",
}

_SECRET_FILE_EXTENSIONS = {".pem", ".p12", ".pfx"}


def _mask_secret(content: str) -> str:
    """Mask sensitive parts of content for safe display."""
    if len(content) <= 8:
        return "***"
    if len(content) <= 20:
        return content[:4] + "***"
    return content[:8] + "..." + content[-8:]


def _is_text_file(file_path: str) -> bool:
    """Check if a file is likely text based on its extension."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext in _TEXT_EXTENSIONS:
        return True

    base_name = os.path.basename(file_path).lower()
    no_ext_patterns = [
        "readme", "license", "makefile", "dockerfile", "vagrantfile",
        ".env", ".gitignore", ".dockerignore", ".npmignore",
    ]
    for pattern in no_ext_patterns:
        if base_name == pattern or base_name.startswith(pattern + "."):
            return True

    return False


def detect_secrets_in_content(content: str) -> List[SecretMatch]:
    """
    Scan content string for secrets.

    Args:
        content: The text content to scan

    Returns:
        List of SecretMatch objects for detected secrets
    """
    matches: List[SecretMatch] = []
    lines = content.split("\n")

    for line_num, line in enumerate(lines, start=1):
        for secret_type, pattern in SECRET_PATTERNS.items():
            if pattern.search(line):
                matches.append(
                    SecretMatch(
                        secret_type=secret_type,
                        line=line_num,
                        masked_value=_mask_secret(line.strip()),
                    )
                )

    return matches


def scan_file_for_secrets(file_path: str) -> List[SecretMatch]:
    """
    Scan a single file for secrets.

    Args:
        file_path: Path to the file to scan

    Returns:
        List of SecretMatch objects for detected secrets
    """
    if not _is_text_file(file_path):
        return []

    try:
        with open(file_path, encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        return []

    matches = detect_secrets_in_content(content)
    for match in matches:
        match.file_path = file_path

    return matches


def scan_directory_for_secrets(
    directory: str,
    exclude_patterns: Optional[List[str]] = None,
) -> List[SecretMatch]:
    """
    Recursively scan a directory for secrets.

    Args:
        directory: Path to the directory to scan
        exclude_patterns: List of glob patterns for files to skip

    Returns:
        List of SecretMatch objects for detected secrets
    """
    import fnmatch

    all_matches: List[SecretMatch] = []
    exclude_patterns = exclude_patterns or []

    for root, _dirs, files in os.walk(directory):
        for file_name in files:
            # Check exclusion patterns
            skip = False
            for pattern in exclude_patterns:
                if fnmatch.fnmatch(file_name, pattern):
                    skip = True
                    break
            if skip:
                continue

            file_path = os.path.join(root, file_name)

            if not _is_text_file(file_path):
                continue

            matches = scan_file_for_secrets(file_path)
            all_matches.extend(matches)

    return all_matches


def should_exclude_file(file_path: str) -> bool:
    """
    Check if a file should be excluded from packaging based on security concerns.

    Args:
        file_path: Path to the file to check

    Returns:
        True if the file should be excluded
    """
    base_name = os.path.basename(file_path).lower()
    ext = os.path.splitext(base_name)[1].lower()

    # Check exact file name matches
    if base_name in _SECRET_FILE_NAMES:
        return True

    # Check extension matches
    if ext in _SECRET_FILE_EXTENSIONS:
        return True

    # Check for dangerous keywords in config/data files
    dangerous_keywords = ["secret", "key", "token", "password", "credential", "private"]
    config_extensions = {".json", ".yaml", ".yml", ".env", ".txt"}
    for keyword in dangerous_keywords:
        if keyword in base_name and ext in config_extensions:
            return True

    return False
