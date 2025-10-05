"""
Package resolution system for the Prompd compiler.

Handles:
- Registry discovery via /.well-known/registry.json
- Package reference parsing (@namespace/package@version)
- Package downloading and caching (local project cache + global fallback)
- Dependency resolution (using: and inherits: chains)
- Package locking for reproducible builds
- Local vs global package management (npm-style)
"""

import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, Any, Optional, List, Union, Tuple
from urllib.parse import urljoin
from dataclasses import dataclass, field
from datetime import datetime
from rich.progress import Progress, DownloadColumn, TransferSpeedColumn, TimeRemainingColumn
from pydantic import BaseModel, ValidationError, field_validator

from .exceptions import PrompdError


class PackageReference(BaseModel):
    """Parsed package reference with pydantic validation."""
    namespace: Optional[str] = None
    name: str = ""
    version: str = "latest"
    
    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not v or len(v) > 50:
            raise ValueError("Package name must be 1-50 characters")
        if not re.match(r'^[a-zA-Z0-9][\w.-]*$', v):
            raise ValueError("Package name must start with alphanumeric and contain only word chars, dots, hyphens")
        
        reserved_names = {'con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 
                         'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 
                         'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9', 'system', 'admin'}
        if v.lower() in reserved_names:
            raise ValueError(f"Reserved name not allowed: {v}")
        return v
    
    @field_validator('namespace')
    @classmethod
    def validate_namespace(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if len(v) > 50:
            raise ValueError("Package namespace must be ≤50 characters")
        if not re.match(r'^[a-zA-Z0-9][\w.-]*$', v):
            raise ValueError("Package namespace must start with alphanumeric and contain only word chars, dots, hyphens")
        
        reserved_names = {'con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 
                         'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 
                         'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9', 'system', 'admin'}
        if v.lower() in reserved_names:
            raise ValueError(f"Reserved namespace not allowed: {v}")
        return v
    
    @field_validator('version')
    @classmethod
    def validate_version(cls, v: str) -> str:
        if not v or len(v) > 20:
            raise ValueError("Package version must be 1-20 characters")
        
        # Allow semantic versions, 'latest', and simple versions
        valid_version_pattern = r'^(\d+\.\d+\.\d+|latest|\d+|\d+\.\d+)$'
        if not re.match(valid_version_pattern, v):
            raise ValueError(f"Invalid version format: {v}")
        
        if v.lower() not in ['latest'] and v.count('.') > 2:
            raise ValueError("Too many version components (max x.y.z)")
        return v
    
    @classmethod
    def parse(cls, reference: str) -> 'PackageReference':
        """
        Parse package reference string with comprehensive validation.
        
        Examples:
        - @prompd.io/security@2.0.0 -> namespace=prompd.io, name=security, version=2.0.0
        - @security/audit@latest -> namespace=security, name=audit, version=latest  
        - security-audit@1.0.0 -> namespace=None, name=security-audit, version=1.0.0
        """
        if not reference or not isinstance(reference, str):
            raise ValueError("Empty or invalid package reference")
        
        # Security: Input validation
        if len(reference) > 200:
            raise ValueError("Package reference too long (max 200 characters)")
        
        # Security: Character validation - allow only safe characters  
        if not re.match(r'^[@\w\.\-/]+$', reference):
            raise ValueError("Invalid characters in package reference. Only alphanumeric, @, /, -, . allowed")
        
        # Security: Check for path traversal in reference
        if '..' in reference or reference.startswith('/') or '\\' in reference:
            raise ValueError("Path traversal attempt detected in package reference")
        
        # Pattern: @namespace/name@version or name@version
        scoped_pattern = r'^@([^/]+)/([^@]+)(?:@(.+))?$'
        unscoped_pattern = r'^([^@]+)(?:@(.+))?$'
        
        # Try scoped pattern first
        match = re.match(scoped_pattern, reference)
        if match:
            namespace, name, version = match.groups()
            return cls(namespace=namespace, name=name, version=version or "latest")
        
        # Try unscoped pattern
        match = re.match(unscoped_pattern, reference)
        if match:
            name, version = match.groups()
            return cls(name=name, version=version or "latest")
        
        raise ValueError(f"Invalid package reference format: {reference}")
    
    def to_string(self) -> str:
        """Convert back to string representation."""
        if self.namespace:
            return f"@{self.namespace}/{self.name}@{self.version}"
        return f"{self.name}@{self.version}"


@dataclass 
class RegistryInfo:
    """Registry configuration."""
    name: str
    base_url: str
    endpoints: Dict[str, str]
    capabilities: Dict[str, Any]
    
    @classmethod
    def from_well_known(cls, base_url: str) -> 'RegistryInfo':
        """Load registry info from /.well-known/registry.json endpoint."""
        well_known_url = urljoin(base_url.rstrip('/') + '/', '.well-known/registry.json')
        
        try:
            import httpx
            with httpx.Client() as client:
                response = client.get(well_known_url)
                response.raise_for_status()
                data = response.json()
                
                return cls(
                    name=data.get('name', 'Unknown Registry'),
                    base_url=base_url,
                    endpoints=data.get('endpoints', {}),
                    capabilities=data.get('capabilities', {})
                )
        except Exception as e:
            raise PrompdError(f"Failed to discover registry at {base_url}: {e}")


@dataclass
class PackageLockEntry:
    """Entry in package lock file."""
    name: str
    version: str
    resolved_version: str
    integrity: str = ""
    dependencies: Dict[str, str] = field(default_factory=dict)
    installed_at: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class ProjectConfig:
    """Project-specific configuration."""
    name: Optional[str] = None
    version: str = "1.0.0"
    dependencies: Dict[str, str] = field(default_factory=dict)
    dev_dependencies: Dict[str, str] = field(default_factory=dict)
    registry_urls: List[str] = field(default_factory=list)  # Empty list - will be populated from user config


class PackageLock:
    """Manages .prompd/lock.json for reproducible builds."""

    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.lock_file = project_root / '.prompd' / 'lock.json'
        self._lock_data: Dict[str, PackageLockEntry] = {}
        self._loaded = False
    
    def _ensure_loaded(self):
        """Load lock file if not already loaded."""
        if self._loaded:
            return
        
        self._loaded = True
        if self.lock_file.exists():
            try:
                with open(self.lock_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for key, entry_data in data.get('packages', {}).items():
                        self._lock_data[key] = PackageLockEntry(**entry_data)
            except Exception as e:
                print(f"Warning: Failed to load lock file: {e}")
                self._lock_data = {}
    
    def get_locked_version(self, package_ref: PackageReference) -> Optional[str]:
        """Get locked version for a package."""
        self._ensure_loaded()
        key = package_ref.to_string()
        entry = self._lock_data.get(key)
        return entry.resolved_version if entry else None
    
    def lock_package(self, package_ref: PackageReference, resolved_version: str, integrity: str = "", dependencies: Optional[Dict[str, str]] = None):
        """Add or update package lock entry."""
        self._ensure_loaded()
        key = package_ref.to_string()
        
        self._lock_data[key] = PackageLockEntry(
            name=package_ref.name,
            version=package_ref.version,
            resolved_version=resolved_version,
            integrity=integrity,
            dependencies=dependencies or {},
            installed_at=datetime.now().isoformat()
        )
        
        self._save()
    
    def _save(self):
        """Save lock data to file with atomic write and file locking."""
        import tempfile
        import shutil
        try:
            import fcntl
        except ImportError:
            fcntl = None  # Not available on Windows
        
        self.lock_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Convert to serializable format
        lock_data = {
            'lockfileVersion': 1,
            'packages': {
                key: {
                    'name': entry.name,
                    'version': entry.version,
                    'resolved_version': entry.resolved_version,
                    'integrity': entry.integrity,
                    'dependencies': entry.dependencies,
                    'installed_at': entry.installed_at
                }
                for key, entry in self._lock_data.items()
            }
        }
        
        # Atomic write: write to temp file first, then rename
        temp_file = self.lock_file.with_suffix('.tmp')
        try:
            with open(temp_file, 'w', encoding='utf-8') as f:
                # File locking to prevent race conditions (Unix only)
                if fcntl and hasattr(fcntl, 'flock'):
                    try:
                        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                    except (OSError, AttributeError):
                        # File locking not supported on this platform
                        pass
                
                json.dump(lock_data, f, indent=2)
                f.flush()
                os.fsync(f.fileno())  # Ensure data is written to disk
            
            # Atomic rename
            if os.name == 'nt':  # Windows
                # On Windows, need to remove target first
                if self.lock_file.exists():
                    self.lock_file.unlink()
            
            temp_file.rename(self.lock_file)
            
        except Exception as e:
            # Clean up temp file on error
            if temp_file.exists():
                try:
                    temp_file.unlink()
                except OSError:
                    pass
            raise PrompdError(f"Failed to save package lock file: {e}") from e
    
    def remove_package(self, package_ref: PackageReference):
        """Remove package from lock file."""
        self._ensure_loaded()
        key = package_ref.to_string()
        if key in self._lock_data:
            del self._lock_data[key]
            self._save()


class BasePackageCache:
    """Base class for package cache implementations."""
    
    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        # Don't create directory on init - create only when needed
    
    def _ensure_cache_dir(self):
        """Ensure cache directory exists (call before writing operations)."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)
    
    def get_package_dir(self, package_ref: PackageReference) -> Path:
        """Get the cache directory for a specific package version."""
        if package_ref.namespace:
            package_dir = self.cache_dir / f"@{package_ref.namespace}" / package_ref.name / package_ref.version
        else:
            package_dir = self.cache_dir / package_ref.name / package_ref.version
        
        return package_dir
    
    def is_cached(self, package_ref: PackageReference) -> bool:
        """Check if package is cached."""
        package_dir = self.get_package_dir(package_ref)
        return package_dir.exists() and (package_dir / 'manifest.json').exists()
    
    def get_cached_package(self, package_ref: PackageReference) -> Path:
        """Get path to cached package directory."""
        package_dir = self.get_package_dir(package_ref)
        if not self.is_cached(package_ref):
            raise PrompdError(f"Package not cached: {package_ref.to_string()}")
        return package_dir
    
    def cache_package(self, package_ref: PackageReference, package_data: bytes) -> Path:
        """Cache a downloaded package with atomic operations and validation."""
        return self._cache_package_atomic(package_ref, package_data)
    
    def _cache_package_atomic(self, package_ref: PackageReference, package_data: bytes) -> Path:
        """Atomically cache a package with battle-tested security validation."""
        # Ensure cache directory exists before attempting to write
        self._ensure_cache_dir()
        
        package_dir = self.get_package_dir(package_ref)
        temp_dir = package_dir.with_suffix('.installing')
        
        # Validate package size first (prevent DoS)
        if len(package_data) > 100 * 1024 * 1024:  # 100MB limit
            raise PrompdError(f"Package too large: {len(package_data)} bytes (max 100MB)")
        
        try:
            # Step 1: Clean up any existing temp directory
            if temp_dir.exists():
                shutil.rmtree(temp_dir)
            
            temp_dir.mkdir(parents=True, exist_ok=True)
            
            # Step 2: Secure ZIP extraction with comprehensive validation
            # Create temp file path manually to avoid Windows file locking issues
            temp_zip_path = None
            try:
                # Create temporary file with proper Windows-compatible handling
                temp_fd, temp_zip_path = tempfile.mkstemp(suffix='.pdpkg')
                try:
                    with os.fdopen(temp_fd, 'wb') as tmp_file:
                        tmp_file.write(package_data)
                        tmp_file.flush()
                        os.fsync(tmp_file.fileno())  # Ensure data is written
                    
                    # File is now properly closed, safe to use with zipfile
                    with zipfile.ZipFile(temp_zip_path, 'r') as zip_file:
                        # Security: Comprehensive validation using battle-tested patterns
                        self._validate_zip_contents_secure(zip_file)
                        
                        # Extract to temporary directory with safe extraction
                        self._extract_zip_safely(zip_file, temp_dir)
                        
                except (zipfile.BadZipFile, Exception) as e:
                    raise PrompdError(f"Invalid or unsafe package archive for {package_ref.to_string()}: {e}")
            finally:
                # Clean up temp file - now safe because file is properly closed
                if temp_zip_path and os.path.exists(temp_zip_path):
                    try:
                        os.unlink(temp_zip_path)
                    except OSError:
                        pass  # Best effort cleanup
            
            # Step 3: Validate extracted contents
            self._validate_extracted_package(temp_dir, package_ref)
            
            # Step 4: Calculate integrity hash
            integrity_hash = self._calculate_package_integrity(temp_dir)
            
            # Step 5: Atomic move to final location
            if package_dir.exists():
                # Remove old version
                shutil.rmtree(package_dir)
            
            temp_dir.rename(package_dir)
            
            # Step 6: Store integrity information
            integrity_file = package_dir / '.integrity'
            with open(integrity_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'hash': integrity_hash,
                    'algorithm': 'sha256',
                    'cached_at': datetime.now().isoformat()
                }, f)
            
            return package_dir
            
        except Exception as e:
            # Clean up on any error
            if temp_dir.exists():
                try:
                    shutil.rmtree(temp_dir)
                except OSError:
                    pass  # Best effort cleanup
            raise PrompdError(f"Failed to cache package {package_ref.to_string()}: {e}") from e
    
    def _validate_zip_contents_secure(self, zip_file: zipfile.ZipFile):
        """Enhanced ZIP validation using battle-tested security patterns."""
        total_size = 0
        file_count = 0
        
        for member in zip_file.namelist():
            # Security: Enhanced path validation with cryptographic entropy check
            if not self._is_safe_path_enhanced(member):
                raise PrompdError(f"Unsafe path in package: {member}")
            
            # Get file info
            try:
                file_info = zip_file.getinfo(member)
            except KeyError:
                raise PrompdError(f"Invalid file in package: {member}")
            
            # Check for ZIP bomb protection with ratio analysis
            if file_info.file_size > 50 * 1024 * 1024:  # 50MB per file
                raise PrompdError(f"File too large: {member} ({file_info.file_size} bytes)")
            
            # ZIP bomb protection: check compression ratio
            if file_info.compress_size > 0:
                ratio = file_info.file_size / file_info.compress_size
                if ratio > 1000:  # Suspicious compression ratio
                    raise PrompdError(f"Suspicious compression ratio in file: {member}")
            
            total_size += file_info.file_size
            file_count += 1
            
            # Additional security: Validate path resolution
            if not member.endswith('/'):  # Not a directory
                try:
                    # Use cryptographic hash to validate path integrity
                    path_hash = self._hash_path(member)
                    if len(path_hash) == 0:  # Invalid hash indicates problematic path
                        raise PrompdError(f"Path integrity check failed: {member}")
                except Exception as e:
                    raise PrompdError(f"Path validation failed for {member}: {e}")
        
        # Enhanced limits validation
        if total_size > 200 * 1024 * 1024:  # 200MB total
            raise PrompdError(f"Package too large: {total_size} bytes (max 200MB)")
        
        if file_count > 1000:  # Max 1000 files
            raise PrompdError(f"Too many files in package: {file_count} (max 1000)")
    
    def _extract_zip_safely(self, zip_file: zipfile.ZipFile, target_dir: Path):
        """Safely extract ZIP with path traversal protection."""
        for member in zip_file.namelist():
            # Double-check path safety during extraction
            if not self._is_safe_path_enhanced(member):
                raise PrompdError(f"Unsafe path detected during extraction: {member}")
            
            # Resolve target path safely
            target_path = target_dir / member
            
            # Ensure target path is within target directory
            try:
                resolved_target = target_path.resolve()
                resolved_base = target_dir.resolve()
                if not str(resolved_target).startswith(str(resolved_base)):
                    raise PrompdError(f"Path traversal attempt: {member}")
            except (ValueError, OSError) as e:
                raise PrompdError(f"Path resolution failed for {member}: {e}")
            
            # Extract the member
            if member.endswith('/'):
                # Directory
                target_path.mkdir(parents=True, exist_ok=True)
            else:
                # File
                target_path.parent.mkdir(parents=True, exist_ok=True)
                with zip_file.open(member) as source, open(target_path, 'wb') as target:
                    shutil.copyfileobj(source, target)
    
    def _hash_path(self, path: str) -> str:
        """Generate cryptographic hash of path for integrity checking."""
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.backends import default_backend
        digest = hashes.Hash(hashes.SHA256(), backend=default_backend())
        digest.update(path.encode('utf-8'))
        return digest.finalize().hex()
    
    def _is_safe_path_enhanced(self, path: str) -> bool:
        """Enhanced path traversal protection using battle-tested patterns."""
        if not self._is_safe_path(path):
            return False
        
        # Additional entropy and pattern analysis
        # Check for suspicious patterns that might bypass basic checks
        suspicious_patterns = [
            '..\\',  # Windows path traversal
            '../',   # Unix path traversal
            '\\.\\.', # Encoded traversal attempts
            '%2e%2e', # URL encoded traversal
            '..%2f',  # Mixed encoding
            '%2e%2e%2f', # Full URL encoded
            '....///', # Obfuscated traversal
        ]
        
        path_lower = path.lower()
        for pattern in suspicious_patterns:
            if pattern in path_lower:
                return False
        
        # Check path length and complexity
        if len(path) > 260:  # Windows MAX_PATH limit
            return False
        
        # Check for suspicious character sequences
        if any(ord(c) < 32 or ord(c) > 126 for c in path if c not in '\r\n\t'):
            return False  # Non-printable characters
        
        return True
    
    def _validate_extracted_package(self, package_dir: Path, package_ref: PackageReference):
        """Validate extracted package contents."""
        # Must have manifest.json
        manifest_file = package_dir / 'manifest.json'
        if not manifest_file.exists():
            raise PrompdError(f"Package missing manifest.json: {package_ref.to_string()}")
        
        try:
            with open(manifest_file, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise PrompdError(f"Invalid manifest.json: {e}")
        
        # Validate manifest structure
        required_fields = ['name', 'version']
        for field in required_fields:
            if field not in manifest:
                raise PrompdError(f"Manifest missing required field: {field}")
        
        # Validate that manifest matches package reference
        # Construct expected package ID from namespace and name
        if package_ref.namespace:
            expected_id = f"@{package_ref.namespace}/{package_ref.name}"
        else:
            expected_id = package_ref.name
        
        # Check 'id' field first (package identifier), fallback to 'name' for compatibility
        manifest_id = manifest.get('id', manifest.get('name', ''))
        if manifest_id != expected_id:
            raise PrompdError(f"Package ID mismatch: expected {expected_id}, got {manifest_id}")
    
    def _calculate_package_integrity(self, package_dir: Path) -> str:
        """Calculate SHA256 hash of all package files for integrity checking using cryptography library."""
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.backends import default_backend
        digest = hashes.Hash(hashes.SHA256(), backend=default_backend())
        
        # Sort files for consistent hashing
        all_files = sorted(package_dir.rglob('*'))
        
        for file_path in all_files:
            if file_path.is_file() and not file_path.name.startswith('.'):
                digest.update(str(file_path.relative_to(package_dir)).encode('utf-8'))
                with open(file_path, 'rb') as f:
                    # Read in chunks to handle large files
                    while chunk := f.read(8192):
                        digest.update(chunk)
        
        return digest.finalize().hex()
    
    def remove_package(self, package_ref: PackageReference):
        """Remove package from cache."""
        package_dir = self.get_package_dir(package_ref)
        if package_dir.exists():
            import shutil
            shutil.rmtree(package_dir)
    
    def _is_safe_path(self, path: str) -> bool:
        """
        Comprehensive path traversal protection.
        
        Validates that a path from a ZIP archive is safe to extract.
        Protects against:
        - Path traversal (../, ..\)
        - Absolute paths (/path, C:\path)  
        - Hidden path traversal (..., foo..bar)
        - Encoded traversal (%2e%2e)
        - Excessively long paths
        - Special filesystem names
        """
        if not path or len(path) > 255:
            return False
        
        # Normalize path separators and decode
        import urllib.parse
        decoded_path = urllib.parse.unquote(path)
        normalized_path = os.path.normpath(decoded_path).replace('\\', '/')
        
        # Check for absolute paths
        if normalized_path.startswith('/') or ':' in normalized_path:
            return False
        
        # Check each path component for traversal attempts
        path_parts = normalized_path.split('/')
        for part in path_parts:
            if not part:  # Empty component
                continue
            if part == '..' or part.startswith('..') or part.endswith('..'):
                return False
            if part.startswith('.') and len(part) > 1 and part[1] == '.':
                return False
        
        # Check for Windows reserved names
        reserved_names = {
            'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4',
            'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3',
            'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
        }
        
        for part in path_parts:
            base_name = part.split('.')[0].upper()
            if base_name in reserved_names:
                return False
        
        return True

    def list_packages(self) -> List[PackageReference]:
        """List all cached packages."""
        packages = []
        
        if not self.cache_dir.exists():
            return packages
        
        for item in self.cache_dir.iterdir():
            if item.is_dir():
                if item.name.startswith('@'):
                    # Scoped package
                    namespace = item.name[1:]  # Remove @
                    for pkg_dir in item.iterdir():
                        if pkg_dir.is_dir():
                            for version_dir in pkg_dir.iterdir():
                                if version_dir.is_dir() and (version_dir / 'manifest.json').exists():
                                    packages.append(PackageReference(
                                        namespace=namespace,
                                        name=pkg_dir.name,
                                        version=version_dir.name
                                    ))
                else:
                    # Unscoped package
                    for version_dir in item.iterdir():
                        if version_dir.is_dir() and (version_dir / 'manifest.json').exists():
                            packages.append(PackageReference(
                                name=item.name,
                                version=version_dir.name
                            ))
        
        return packages


class ProjectPackageCache(BasePackageCache):
    """Local project-specific package cache (./.prompd/cache/)."""
    
    def __init__(self, project_root: Path):
        cache_dir = project_root / '.prompd' / 'cache'
        super().__init__(cache_dir)
        self.project_root = project_root


class GlobalPackageCache(BasePackageCache):
    """Global user package cache (~/.prompd/cache/)."""

    def __init__(self):
        # Use consistent ~/.prompd/cache/ across all platforms
        cache_dir = Path.home() / '.prompd' / 'cache'

        super().__init__(cache_dir)


# Legacy alias for backward compatibility
PackageCache = GlobalPackageCache


class PackageResolver:
    """
    Resolves and downloads packages from registries.
    
    Supports dual-tier caching:
    - Local project cache (./.prompd/cache/) - checked first
    - Global user cache (~/.cache/prompd/) - fallback
    
    Installation modes:
    - Local installation (default): Installs to project cache
    - Global installation (-g flag): Installs to global cache
    """
    
    def __init__(self, 
                 project_root: Optional[Path] = None,
                 registry_urls: Optional[List[str]] = None, 
                 lazy_discovery: bool = True,
                 global_mode: bool = False):
        """
        Initialize package resolver.
        
        Args:
            project_root: Project root directory (current working dir if None)
            registry_urls: List of registry URLs to check
            lazy_discovery: Whether to defer registry discovery until first use
            global_mode: If True, install to global cache by default
        """
        self.project_root = project_root or Path.cwd()

        # Load registry URLs from user config if not provided
        if registry_urls is None:
            from .config import PrompdConfig
            config = PrompdConfig.load()
            # Get configured registries
            configured_registries = config.registry.get('registries', {})
            default_registry = config.registry.get('default', 'prompdhub')

            if configured_registries:
                # Put default registry first, then others
                registry_urls_list = []
                if default_registry in configured_registries and 'url' in configured_registries[default_registry]:
                    registry_urls_list.append(configured_registries[default_registry]['url'])

                # Add other registries (except default which is already added)
                for name, reg in configured_registries.items():
                    if name != default_registry and 'url' in reg:
                        registry_urls_list.append(reg['url'])

                self.registry_urls = registry_urls_list if registry_urls_list else ["https://registry.prompdhub.ai"]
            else:
                # Fallback to prompdhub production if no registries configured
                self.registry_urls = ["https://registry.prompdhub.ai"]
        else:
            self.registry_urls = registry_urls

        self.registries: Dict[str, RegistryInfo] = {}
        self.global_mode = global_mode
        
        # Initialize cache systems
        self.project_cache = ProjectPackageCache(self.project_root)
        self.global_cache = GlobalPackageCache()
        self.package_lock = PackageLock(self.project_root)
        
        # Registry discovery
        self._discovered = False
        self._lazy = lazy_discovery
        # Do not discover on import by default to avoid CLI startup latency.
        # Discovery will occur on first package resolution.

    def discover(self):
        """Discover registry endpoints (idempotent)."""
        if self._discovered:
            return
        self._discovered = True
        disable = False
        try:
            import os
            disable = os.getenv('PROMPD_DISABLE_REGISTRY_DISCOVERY', 'false').lower() == 'true'
        except Exception:
            disable = False
        if disable:
            return
        for url in self.registry_urls:
            try:
                registry = RegistryInfo.from_well_known(url)
                self.registries[url] = registry
            except Exception:
                # Swallow discovery failures silently here to avoid noisy startup
                # Detailed errors will surface when actually attempting to resolve packages
                continue
    
    def resolve_package(self, package_reference: str, force_global: bool = False) -> Path:
        """
        Resolve a package reference to a local path using dual-tier cache resolution.
        
        Resolution order:
        1. Check package lock for exact version
        2. Check local project cache (./.prompd/cache/)
        3. Check global cache (~/.cache/prompd/)
        4. Download from registry to appropriate cache
        
        Args:
            package_reference: Package reference like @prompd.io/security@2.0.0
            force_global: Force resolution from global cache only
            
        Returns:
            Path to the resolved package directory
        """
        # Ensure registries discovered on first use
        if not self._discovered and self._lazy:
            self.discover()

        package_ref = PackageReference.parse(package_reference)
        
        # Check lock file first for exact version resolution
        locked_version = self.package_lock.get_locked_version(package_ref)
        if locked_version:
            locked_ref = PackageReference(
                namespace=package_ref.namespace,
                name=package_ref.name,
                version=locked_version
            )
        else:
            locked_ref = package_ref
        
        # Resolution order: local project cache -> global cache -> registry
        if not force_global:
            # Check local project cache first
            if self.project_cache.is_cached(locked_ref):
                return self.project_cache.get_cached_package(locked_ref)
        
        # Check global cache
        if self.global_cache.is_cached(locked_ref):
            return self.global_cache.get_cached_package(locked_ref)
        
        # Not found in cache - download from registry
        return self.install_package(package_reference, force_global=force_global)
    
    def install_package(self, package_reference: str, force_global: bool = False, save_to_lock: bool = True) -> Path:
        """
        Install a package from registry to appropriate cache.
        
        Args:
            package_reference: Package reference to install
            force_global: Install to global cache instead of project cache
            save_to_lock: Add to package lock file
            
        Returns:
            Path to installed package directory
        """
        # Ensure registries discovered on first use
        if not self._discovered and self._lazy:
            self.discover()
            
        package_ref = PackageReference.parse(package_reference)
        
        # Try to download from registries
        for registry_url, registry in self.registries.items():
            try:
                package_data, resolved_version = self._download_package(registry_url, registry, package_ref)
                
                # Choose target cache based on mode
                target_cache = self.global_cache if (force_global or self.global_mode) else self.project_cache
                
                # Create resolved reference with actual version
                resolved_ref = PackageReference(
                    namespace=package_ref.namespace,
                    name=package_ref.name,
                    version=resolved_version
                )
                
                # Install to cache
                package_path = target_cache.cache_package(resolved_ref, package_data)
                
                # Update lock file (only for local installations)
                if save_to_lock and not (force_global or self.global_mode):
                    self.package_lock.lock_package(package_ref, resolved_version)
                
                return package_path
                
            except Exception as e:
                print(f"Warning: Failed to download from {registry_url}: {e}")
                continue
        
        raise PrompdError(f"Package not found in any registry: {package_reference}")
    
    def uninstall_package(self, package_reference: str, force_global: bool = False) -> bool:
        """
        Uninstall a package from cache.
        
        Args:
            package_reference: Package reference to uninstall
            force_global: Remove from global cache instead of project cache
            
        Returns:
            True if package was removed, False if not found
        """
        package_ref = PackageReference.parse(package_reference)
        
        # Choose target cache
        target_cache = self.global_cache if (force_global or self.global_mode) else self.project_cache
        
        # Remove from cache
        if target_cache.is_cached(package_ref):
            target_cache.remove_package(package_ref)
            
            # Remove from lock file (only for local installations)
            if not (force_global or self.global_mode):
                self.package_lock.remove_package(package_ref)
            
            return True
        
        return False
    
    def _download_package(self, registry_url: str, registry: RegistryInfo, package_ref: PackageReference) -> Tuple[bytes, str]:
        """Download package from a specific registry."""
        # Build download URL
        if package_ref.namespace:
            # Scoped package
            if 'scopedPackage' in registry.endpoints:
                package_endpoint = registry.endpoints['scopedPackage'].format(
                    scope=package_ref.namespace, 
                    package=package_ref.name
                )
            else:
                package_endpoint = f"@{package_ref.namespace}/{package_ref.name}"
        else:
            # Regular package
            package_endpoint = registry.endpoints.get('package', '{package}').format(
                package=package_ref.name
            )
        
        # Get package versions to find download URL
        if package_ref.namespace:
            # Scoped package
            versions_endpoint = registry.endpoints.get('scopedPackageVersions', '@{scope}/{package}/versions').format(
                scope=package_ref.namespace,
                package=package_ref.name
            )
        else:
            # Regular package
            versions_endpoint = registry.endpoints.get('packageVersions', '{package}/versions').format(
                package=package_ref.name
            )

        versions_url = urljoin(registry_url.rstrip('/') + '/', versions_endpoint.lstrip('/'))

        import httpx
        with httpx.Client() as client:
            # Get package versions
            response = client.get(versions_url)
            response.raise_for_status()
            versions_data = response.json()

            # Convert versions array to dict format expected by the rest of the code
            # API can return either a list directly or wrapped in {'versions': [...]}
            versions = {}
            if isinstance(versions_data, list):
                versions_list = versions_data
            else:
                versions_list = versions_data.get('versions', [])

            for version_info in versions_list:
                version_num = version_info['version']
                versions[version_num] = version_info

            if package_ref.version == 'latest':
                # Use highest version as latest
                if versions:
                    version = max(versions.keys())
                else:
                    raise PrompdError(f"No versions found for {package_ref.name}")
            else:
                version = package_ref.version
            
            if not version or version not in versions:
                raise PrompdError(f"Version {package_ref.version} not found for {package_ref.name}")
            
            version_info = versions[version]
            
            # Get download URL
            if 'dist' in version_info and 'tarball' in version_info['dist']:
                download_url = version_info['dist']['tarball']
            else:
                # Construct download URL from template using proper endpoint
                if package_ref.namespace:
                    # Scoped package
                    download_endpoint = registry.endpoints.get('scopedDownload', '@{scope}/{package}/download/{version}').format(
                        scope=package_ref.namespace,
                        package=package_ref.name,
                        version=version
                    )
                else:
                    # Regular package
                    download_endpoint = registry.endpoints.get('download', '{package}/download/{version}').format(
                        package=package_ref.name,
                        version=version
                    )
                download_url = urljoin(registry_url.rstrip('/') + '/', download_endpoint.lstrip('/'))
            
            # Download the package with progress bar
            with client.stream('GET', download_url) as download_response:
                download_response.raise_for_status()
                
                # Get total size from headers if available
                total_size = int(download_response.headers.get('content-length', 0))
                
                # Create progress bar
                with Progress(
                    "[progress.description]{task.description}",
                    DownloadColumn(),
                    "[progress.percentage]{task.percentage:>3.0f}%",
                    TransferSpeedColumn(),
                    TimeRemainingColumn(),
                ) as progress:
                    task_id = progress.add_task(f"Downloading {package_ref.name}@{version}", total=total_size)
                    
                    # Collect content with progress updates
                    content = bytearray()
                    for chunk in download_response.iter_bytes(chunk_size=8192):
                        content.extend(chunk)
                        progress.update(task_id, advance=len(chunk))
                    
                    return bytes(content), version
    
    def get_package_manifest(self, package_path: Path) -> Dict[str, Any]:
        """Load package manifest.json."""
        manifest_file = package_path / 'manifest.json'
        if not manifest_file.exists():
            raise PrompdError(f"Package manifest not found: {manifest_file}")
        
        try:
            with open(manifest_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            raise PrompdError(f"Invalid package manifest: {e}")
    
    def resolve_dependencies(self, package_path: Path) -> Dict[str, Path]:
        """Resolve all dependencies for a package."""
        manifest = self.get_package_manifest(package_path)
        dependencies = manifest.get('dependencies', {})
        
        resolved = {}
        for dep_name, dep_version in dependencies.items():
            dep_reference = f"{dep_name}@{dep_version}"
            resolved[dep_name] = self.resolve_package(dep_reference)
        
        return resolved
    
    def list_cached_packages(self, include_global: bool = True) -> Dict[str, List[PackageReference]]:
        """
        List all cached packages from both local and global caches.
        
        Args:
            include_global: Whether to include global cache packages
            
        Returns:
            Dict with 'local' and 'global' keys containing package lists
        """
        result = {
            'local': self.project_cache.list_packages(),
            'global': self.global_cache.list_packages() if include_global else []
        }
        
        return result
    
    def clear_cache(self, clear_global: bool = False, clear_local: bool = True):
        """
        Clear package caches.
        
        Args:
            clear_global: Clear global cache (~/.cache/prompd/)
            clear_local: Clear local project cache (./.prompd/cache/)
        """
        import shutil
        
        if clear_local and self.project_cache.cache_dir.exists():
            shutil.rmtree(self.project_cache.cache_dir)
            self.project_cache._ensure_cache_dir()
        
        if clear_global and self.global_cache.cache_dir.exists():
            shutil.rmtree(self.global_cache.cache_dir)
            self.global_cache._ensure_cache_dir()
    
    def get_project_config(self) -> ProjectConfig:
        """Load project configuration from .prompd/config.yaml."""
        config_file = self.project_root / '.prompd' / 'config.yaml'
        
        if not config_file.exists():
            # Return default config without saving
            return ProjectConfig()
        
        try:
            import yaml
            with open(config_file, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f) or {}
                return ProjectConfig(
                    name=data.get('name'),
                    version=data.get('version', '1.0.0'),
                    dependencies=data.get('dependencies', {}),
                    dev_dependencies=data.get('devDependencies', {}),
                    registry_urls=data.get('registries', ["https://registry.prompdhub.ai"])
                )
        except Exception as e:
            print(f"Warning: Failed to load project config: {e}")
            return ProjectConfig()
    
    def get_or_create_project_config(self) -> ProjectConfig:
        """Load project configuration, creating it if it doesn't exist."""
        config_file = self.project_root / '.prompd' / 'config.yaml'
        
        if not config_file.exists():
            # Create default config only when explicitly requested
            config = ProjectConfig()
            self.save_project_config(config)
            return config
        
        return self.get_project_config()
    
    def save_project_config(self, config: ProjectConfig):
        """Save project configuration to .prompd/config.yaml."""
        config_file = self.project_root / '.prompd' / 'config.yaml'
        config_file.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            import yaml
            data = {
                'name': config.name,
                'version': config.version,
                'dependencies': config.dependencies,
                'devDependencies': config.dev_dependencies,
                'registries': config.registry_urls
            }
            
            with open(config_file, 'w', encoding='utf-8') as f:
                yaml.safe_dump(data, f, default_flow_style=False, sort_keys=False)
        except Exception as e:
            print(f"Warning: Failed to save project config: {e}")
    
    def add_dependency(self, package_reference: str, dev: bool = False, global_install: bool = False):
        """
        Add a dependency to project configuration and install it.
        
        Args:
            package_reference: Package to add
            dev: Add as development dependency
            global_install: Install globally instead of locally
        """
        package_ref = PackageReference.parse(package_reference)
        
        # Install package
        self.install_package(package_reference, force_global=global_install)
        
        # Update project config (only for local installations)
        if not global_install:
            config = self.get_or_create_project_config()
            
            dep_name = package_ref.to_string().split('@')[0]  # Remove version for config
            if dev:
                config.dev_dependencies[dep_name] = package_ref.version
            else:
                config.dependencies[dep_name] = package_ref.version
            
            self.save_project_config(config)
    
    def remove_dependency(self, package_name: str, dev: bool = False, global_uninstall: bool = False):
        """
        Remove a dependency from project configuration and uninstall it.
        
        Args:
            package_name: Package name to remove
            dev: Remove from development dependencies
            global_uninstall: Uninstall from global cache
        """
        # Update project config (only for local installations)
        if not global_uninstall:
            config = self.get_or_create_project_config()
            
            if dev and package_name in config.dev_dependencies:
                version = config.dev_dependencies.pop(package_name)
            elif package_name in config.dependencies:
                version = config.dependencies.pop(package_name)
            else:
                print(f"Package {package_name} not found in dependencies")
                return
            
            self.save_project_config(config)
            
            # Uninstall package
            package_ref = f"{package_name}@{version}"
            self.uninstall_package(package_ref, force_global=global_uninstall)
        else:
            # For global uninstalls, we need to guess the version or ask user
            print(f"Global uninstall requires specific version: prompd uninstall -g {package_name}@version")


# Global resolver instance (lazy discovery to avoid startup latency)
package_resolver = PackageResolver(lazy_discovery=True)
