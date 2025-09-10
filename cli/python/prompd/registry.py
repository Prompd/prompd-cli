"""
Prompd Registry Integration

Provides commands for publishing, searching, and installing packages from the Prompd registry.
Integrates with registry.prompdhub.ai API endpoints.
"""

import json
import os
import requests
import zipfile
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Any
import yaml
from dataclasses import dataclass
from rich.progress import Progress, DownloadColumn, TransferSpeedColumn, TimeRemainingColumn, TaskID

from .config import PrompDConfig
from .parser import PrompdParser
from .validator import PrompDValidator
from .package_resolver import RegistryInfo


class RegistryClient:
    """Client for interacting with Prompd registries (multi-registry support)."""
    
    def __init__(self, registry_name: Optional[str] = None):
        self.config = PrompDConfig.load()
        self.registry_name = registry_name or self.config.registry.get('default', 'prompdhub')
        self.session = requests.Session()
        
        # Get registry config
        registries = self.config.registry.get('registries', {})
        if self.registry_name not in registries:
            raise Exception(f"Registry '{self.registry_name}' not found in configuration")
        
        self.registry_config = registries[self.registry_name]
        self.registry_url = self.registry_config['url']
        # Lazy discovery: do not call well-known at init
        self.registry_info = None
        
        # Set up authentication if available
        token = self.registry_config.get('token')
        if token:
            self.session.headers.update({
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json'
            })

    def ensure_discovered(self):
        """Discover registry endpoints once, with short timeout and quiet failure."""
        if self.registry_info is not None:
            return
        try:
            # Perform discovery; RegistryInfo uses httpx default timeout, which is fine for a quick ping
            self.registry_info = RegistryInfo.from_well_known(self.registry_url)
        except Exception:
            # Leave as None; methods will fall back to basic endpoints
            self.registry_info = None
    
    def _get_endpoint_url(self, endpoint_name: str, fallback_path: str, **kwargs) -> str:
        """Get endpoint URL dynamically from registry discovery, with fallback."""
        # Ensure discovery has been attempted before relying on endpoints
        self.ensure_discovered()
        if self.registry_info and endpoint_name in self.registry_info.endpoints:
            endpoint_template = self.registry_info.endpoints[endpoint_name]
            # Replace template variables like {package}
            endpoint_path = endpoint_template.format(**kwargs)
            return f"{self.registry_url}{endpoint_path}"
        else:
            # Fallback to hardcoded paths
            return f"{self.registry_url}{fallback_path}"
    
    def login_with_credentials(self, username: str, password: str) -> Dict[str, Any]:
        """Authenticate with the registry using username and password."""
        try:
            # Login with credentials to get token
            login_data = {
                'username': username,
                'password': password
            }
            
            response = self.session.post(
                f"{self.registry_url}/v1/auth/login", 
                json=login_data
            )
            response.raise_for_status()
            auth_data = response.json()
            
            # Extract token from response
            token = auth_data.get('token') or auth_data.get('access_token')
            if not token:
                raise Exception("No token received from server")
            
            # Set up authentication with the token
            return self.login_with_token(token)
            
        except requests.exceptions.RequestException as e:
            raise Exception(f"Login failed: {e}")
    
    def login_with_token(self, token: str) -> Dict[str, Any]:
        """Authenticate with the registry using an API token."""
        # Update session headers
        self.session.headers.update({
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        })
        
        # Verify token by getting user profile
        try:
            response = self.session.get(f"{self.registry_url}/v1/user/me")
            
            # Better error handling for different response codes
            if response.status_code == 401:
                raise Exception("Invalid token. Please check your API token.")
            elif response.status_code == 404:
                raise Exception(f"User endpoint not found. Registry URL: {self.registry_url}")
            elif response.status_code >= 500:
                raise Exception(f"Registry server error ({response.status_code}). Please try again later.")
            
            response.raise_for_status()
            user_data = response.json()
            
            if not user_data.get('username'):
                raise Exception("Invalid response from registry: missing username")
            
            # Update registry config
            self.registry_config['token'] = token
            self.registry_config['username'] = user_data.get('username')
            
            # Save config
            self.config.save()
            
            return user_data
        except requests.exceptions.RequestException as e:
            if hasattr(e, 'response') and e.response is not None:
                # Try to get error message from response body
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error', str(e))
                except:
                    error_msg = str(e)
                raise Exception(f"Authentication failed: {error_msg}")
            raise Exception(f"Authentication failed: {e}")
    
    # Backwards compatibility
    def login(self, token: str) -> Dict[str, Any]:
        """Authenticate with the registry using an API token (backwards compatibility)."""
        return self.login_with_token(token)
    
    def logout(self):
        """Clear authentication credentials."""
        self.registry_config['token'] = None
        self.registry_config['username'] = None
        self.session.headers.pop('Authorization', None)
        self.config.save()
    
    def search(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Search for packages in the registry."""
        try:
            params = {'q': query, 'limit': limit}
            response = self.session.get(f"{self.registry_url}/v1/packages", params=params)
            response.raise_for_status()
            # Backend returns 'items' not 'packages'
            result = response.json()
            return result.get('items', result.get('packages', []))
        except requests.exceptions.RequestException as e:
            raise Exception(f"Search failed: {e}")
    
    def get_package_info(self, package_name: str) -> Dict[str, Any]:
        """Get detailed information about a package."""
        try:
            response = self.session.get(f"{self.registry_url}/v1/packages/{package_name}")
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise Exception(f"Package info fetch failed: {e}")
    
    def get_package_versions(self, package_name: str) -> List[Dict[str, Any]]:
        """Get version history for a package."""
        try:
            response = self.session.get(f"{self.registry_url}/v1/packages/{package_name}/versions")
            response.raise_for_status()
            return response.json().get('versions', [])
        except requests.exceptions.RequestException as e:
            raise Exception(f"Version fetch failed: {e}")
    
    def publish_package(self, package_path: Path) -> Dict[str, Any]:
        """Publish a .pdpkg package to the registry. ONLY .pdpkg packages are supported."""
        if not self.registry_config.get('token'):
            raise Exception("Authentication required. Run 'prompd registry login' first.")
        
        if package_path.suffix != '.pdpkg':
            raise Exception(f"Only .pdpkg package files are supported. Got: {package_path.suffix}. This is a package registry, not a .prompd file registry.")
        
        return self._publish_pdpkg(package_path)
    
    def _publish_pdpkg(self, package_path: Path) -> Dict[str, Any]:
        """Publish a .pdpkg bundle package."""
        # Validate package structure
        try:
            validate_pdpkg(package_path)
        except Exception as e:
            raise Exception(f"Invalid .pdpkg package: {e}")
        
        # Extract package ID from manifest.json inside the .pdpkg (use ID for URL, not name)
        package_name = "unknown"  # fallback
        try:
            with zipfile.ZipFile(package_path, 'r') as zf:
                if 'manifest.json' in zf.namelist():
                    manifest_data = json.loads(zf.read('manifest.json').decode('utf-8'))
                    # Use ID first (for scoped packages like @prompd.io/core-patterns), fallback to name
                    package_name = manifest_data.get('id', manifest_data.get('name', 'unknown'))
        except Exception:
            pass  # Use fallback
        
        # Upload package
        try:
            # Use the correct publish endpoint directly
            publish_url = f"{self.registry_url}/v1/packages/publish"
            
            with open(package_path, 'rb') as f:
                files = {'package': (package_path.name, f, 'application/zip')}
                
                # Create a new session for this upload to avoid header conflicts
                auth_header = self.session.headers.get('Authorization')
                upload_headers = {'Authorization': auth_header} if auth_header else {}
                
                # Let requests handle multipart encoding completely
                response = requests.post(publish_url, files=files, headers=upload_headers)
                response.raise_for_status()
                return response.json()
        except requests.exceptions.RequestException as e:
            raise Exception(f"Package publish failed: {e}")
    
    def install_package(self, package_name: str, version: Optional[str] = None, install_dir: Optional[Path] = None) -> Path:
        """Install a package from the registry."""
        # Get package info
        package_info = self.get_package_info(package_name)
        
        # Determine version to install
        if version is None:
            version = package_info.get('latest_version')
        
        # Determine install directory
        if install_dir is None:
            install_dir = Path.cwd() / "prompd_packages"
        
        install_dir.mkdir(parents=True, exist_ok=True)
        
        # Download package content with progress bar
        # Use npm-compatible download endpoint format
        # For scoped packages: /@scope/package/-/package-version.pdpkg
        # For unscoped: /package/-/package-version.pdpkg
        
        if package_name.startswith('@'):
            # Scoped package like @prompd.io/core-patterns
            # Extract just the package name without scope for the filename
            package_short_name = package_name.split('/')[-1]
            download_url = f"{self.registry_url}/{package_name}/-/{package_short_name}-{version}.pdpkg"
        else:
            # Unscoped package
            download_url = f"{self.registry_url}/{package_name}/-/{package_name}-{version}.pdpkg"
        
        try:
            # Get file size first for progress tracking
            head_response = self.session.head(download_url)
            head_response.raise_for_status()
            total_size = int(head_response.headers.get('content-length', 0))
            
            # Start streaming download
            response = self.session.get(download_url, stream=True)
            response.raise_for_status()
            
            # Determine target path
            if package_info.get('type') == 'single':
                # Single .prompd file
                target_path = install_dir / f"{package_name.split('/')[-1]}.prompd"
                file_mode = 'w'
                encoding = 'utf-8'
            else:
                # Complex package - save as .pdpkg
                target_path = install_dir / f"{package_name.split('/')[-1]}.pdpkg"
                file_mode = 'wb'
                encoding = None
            
            # Download with progress bar
            with Progress(
                "[progress.description]{task.description}",
                DownloadColumn(),
                "[progress.percentage]{task.percentage:>3.0f}%",
                TransferSpeedColumn(),
                TimeRemainingColumn(),
            ) as progress:
                task_id = progress.add_task(f"Downloading {package_name}@{version}", total=total_size)
                
                with open(target_path, file_mode, encoding=encoding) as f:
                    downloaded = 0
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:  # Filter out keep-alive chunks
                            if package_info.get('type') == 'single':
                                f.write(chunk.decode('utf-8'))
                            else:
                                f.write(chunk)
                            downloaded += len(chunk)
                            progress.update(task_id, advance=len(chunk))
            
            return target_path
            
        except requests.exceptions.RequestException as e:
            raise Exception(f"Package download failed: {e}")


def validate_pdpkg(package_path: Path):
    """Validate a .pdpkg package structure."""
    if not package_path.exists():
        raise Exception(f"Package file not found: {package_path}")
    
    if not zipfile.is_zipfile(package_path):
        raise Exception("Package file is not a valid ZIP archive")
    
    with zipfile.ZipFile(package_path, 'r') as zip_file:
        # Check for manifest
        if 'manifest.json' not in zip_file.namelist():
            raise Exception("Package missing required manifest.json file")
        
        # Validate manifest
        with zip_file.open('manifest.json') as f:
            try:
                manifest = json.loads(f.read().decode('utf-8'))
            except json.JSONDecodeError as e:
                raise Exception(f"Invalid manifest.json: {e}")
        
        # Validate required manifest fields
        required_fields = ['name', 'version', 'description']
        for field in required_fields:
            if field not in manifest:
                raise Exception(f"Manifest missing required field: {field}")
        
        # Validate semantic version
        version = manifest['version']
        if not _is_valid_semver(version):
            raise Exception(f"Invalid semantic version: {version}")
        
        # Validate referenced files exist
        if 'files' in manifest:
            for file_pattern in manifest['files'].get('prompts', []):
                # Simple check - at least one .prompd file should exist
                prompd_files = [f for f in zip_file.namelist() if f.endswith('.prompd')]
                if not prompd_files:
                    raise Exception("Package contains no .prompd files")


def _is_valid_semver(version: str) -> bool:
    """Check if version follows semantic versioning format."""
    import re
    semver_pattern = r'^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
    return re.match(semver_pattern, version) is not None


def _serialize_for_json(obj):
    """Convert Python objects to JSON-serializable format."""
    if hasattr(obj, '__dict__'):
        # Convert dataclass/object to dict
        result = {}
        for key, value in obj.__dict__.items():
            if not key.startswith('_'):  # Skip private attributes
                result[key] = _serialize_for_json(value)
        return result
    elif hasattr(obj, 'value') and hasattr(obj, 'name'):  # Enum-like objects
        return obj.value if hasattr(obj.value, 'lower') else str(obj.value)
    elif isinstance(obj, list):
        return [_serialize_for_json(item) for item in obj]
    elif isinstance(obj, dict):
        return {key: _serialize_for_json(value) for key, value in obj.items()}
    elif isinstance(obj, (str, int, float, bool, type(None))):
        return obj
    else:
        # For any other object, try to convert to string as fallback
        return str(obj)


def create_pdpkg(source_dir: Path, output_path: Path, manifest: Dict[str, Any]):
    """Create a .pdpkg package from a directory."""
    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # Add manifest - ensure it's JSON serializable
        serialized_manifest = _serialize_for_json(manifest)
        zip_file.writestr('manifest.json', json.dumps(serialized_manifest, indent=2))
        
        # Add all files in source directory
        for root, dirs, files in os.walk(source_dir):
            for file in files:
                # Skip .pdproj files - they're only for packaging metadata
                if file.endswith('.pdproj'):
                    continue
                    
                file_path = Path(root) / file
                arcname = file_path.relative_to(source_dir)
                zip_file.write(file_path, arcname)
