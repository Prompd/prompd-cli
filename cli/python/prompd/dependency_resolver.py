"""
Advanced dependency resolution system for Prompd packages.

Implements:
- Recursive dependency resolution
- Version conflict detection and resolution
- Circular dependency detection
- Dependency graph building
- Lock file generation
- Parallel dependency fetching
"""

import json
import asyncio
import semver
from pathlib import Path
from typing import Dict, List, Set, Optional, Tuple, Any
from dataclasses import dataclass, field
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
import networkx as nx

from .package_resolver import PackageReference, PackageResolver, PrompdError
from .exceptions import PrompdError


@dataclass
class DependencyNode:
    """Represents a package in the dependency graph."""
    package_ref: PackageReference
    resolved_version: str
    dependencies: Dict[str, str] = field(default_factory=dict)
    dev_dependencies: Dict[str, str] = field(default_factory=dict)
    peer_dependencies: Dict[str, str] = field(default_factory=dict)
    resolved_path: Optional[Path] = None
    depth: int = 0
    parent: Optional[str] = None
    
    @property
    def id(self) -> str:
        """Unique identifier for the node."""
        return f"{self.package_ref.to_string()}@{self.resolved_version}"
    
    @property
    def name(self) -> str:
        """Package name without version."""
        if self.package_ref.namespace:
            return f"@{self.package_ref.namespace}/{self.package_ref.name}"
        return self.package_ref.name


@dataclass
class VersionConstraint:
    """Represents a version constraint for dependency resolution."""
    raw: str
    operator: str  # '=', '>=', '>', '<=', '<', '^', '~', '*'
    version: Optional[str] = None
    
    @classmethod
    def parse(cls, constraint: str) -> 'VersionConstraint':
        """Parse a version constraint string."""
        constraint = constraint.strip()
        
        # Handle special cases
        if constraint == '*' or constraint == 'latest':
            return cls(constraint, '*')
        
        # Handle caret ranges (^1.2.3)
        if constraint.startswith('^'):
            return cls(constraint, '^', constraint[1:])
        
        # Handle tilde ranges (~1.2.3)
        if constraint.startswith('~'):
            return cls(constraint, '~', constraint[1:])
        
        # Handle comparison operators
        for op in ['>=', '>', '<=', '<', '==', '=']:
            if constraint.startswith(op):
                version = constraint[len(op):].strip()
                return cls(constraint, '=' if op == '==' else op, version)
        
        # Default to exact version match
        return cls(constraint, '=', constraint)
    
    def matches(self, version: str) -> bool:
        """Check if a version satisfies this constraint."""
        if self.operator == '*':
            return True
        
        if not self.version:
            return False
        
        try:
            target = semver.VersionInfo.parse(version)
            constraint_ver = semver.VersionInfo.parse(self.version)
        except ValueError:
            # Fallback to string comparison for non-semver versions
            return self._simple_match(version)
        
        if self.operator == '=':
            return target == constraint_ver
        elif self.operator == '>=':
            return target >= constraint_ver
        elif self.operator == '>':
            return target > constraint_ver
        elif self.operator == '<=':
            return target <= constraint_ver
        elif self.operator == '<':
            return target < constraint_ver
        elif self.operator == '^':
            # Caret range: compatible with specified version
            return (target.major == constraint_ver.major and 
                    target >= constraint_ver)
        elif self.operator == '~':
            # Tilde range: reasonably close to specified version
            return (target.major == constraint_ver.major and
                    target.minor == constraint_ver.minor and
                    target >= constraint_ver)
        
        return False
    
    def _simple_match(self, version: str) -> bool:
        """Simple string-based version matching for non-semver versions."""
        if self.operator == '=':
            return version == self.version
        elif self.operator == '*':
            return True
        # For non-semver, only support exact match or wildcard
        return False


class DependencyResolver:
    """
    Advanced dependency resolver with conflict resolution and circular dependency detection.
    """
    
    def __init__(self, 
                 package_resolver: Optional[PackageResolver] = None,
                 max_depth: int = 100,
                 parallel_downloads: int = 4):
        """
        Initialize dependency resolver.
        
        Args:
            package_resolver: Package resolver instance
            max_depth: Maximum dependency tree depth (prevent infinite recursion)
            parallel_downloads: Number of parallel package downloads
        """
        self.package_resolver = package_resolver or PackageResolver()
        self.max_depth = max_depth
        self.parallel_downloads = parallel_downloads
        
        # Resolution state
        self.graph = nx.DiGraph()
        self.resolved_packages: Dict[str, DependencyNode] = {}
        self.version_constraints: Dict[str, List[Tuple[VersionConstraint, str]]] = defaultdict(list)
        self.resolution_order: List[str] = []
        
    def resolve(self, 
                root_package: str,
                dev_dependencies: bool = False,
                peer_dependencies: bool = False) -> Dict[str, DependencyNode]:
        """
        Resolve all dependencies for a package.
        
        Args:
            root_package: Root package reference (e.g., "@namespace/package@1.0.0")
            dev_dependencies: Include development dependencies
            peer_dependencies: Include peer dependencies
            
        Returns:
            Dict mapping package names to resolved dependency nodes
            
        Raises:
            PrompdError: On resolution conflicts or circular dependencies
        """
        # Clear previous resolution state
        self.graph.clear()
        self.resolved_packages.clear()
        self.version_constraints.clear()
        self.resolution_order.clear()
        
        # Parse root package reference
        root_ref = PackageReference.parse(root_package)
        
        # Start recursive resolution
        self._resolve_recursive(
            root_ref, 
            depth=0, 
            parent=None,
            include_dev=dev_dependencies,
            include_peer=peer_dependencies
        )
        
        # Check for circular dependencies
        if not nx.is_directed_acyclic_graph(self.graph):
            cycles = list(nx.simple_cycles(self.graph))
            raise PrompdError(f"Circular dependencies detected: {cycles}")
        
        # Generate topological order for installation
        self.resolution_order = list(nx.topological_sort(self.graph))
        
        return self.resolved_packages
    
    def _resolve_recursive(self,
                          package_ref: PackageReference,
                          depth: int,
                          parent: Optional[str],
                          include_dev: bool = False,
                          include_peer: bool = False) -> DependencyNode:
        """Recursively resolve package dependencies."""
        if depth > self.max_depth:
            raise PrompdError(f"Maximum dependency depth ({self.max_depth}) exceeded")
        
        package_name = package_ref.to_string().split('@')[0]
        
        # Check if already resolved
        if package_name in self.resolved_packages:
            existing_node = self.resolved_packages[package_name]
            
            # Check version compatibility
            if not self._is_version_compatible(package_ref, existing_node):
                raise PrompdError(
                    f"Version conflict for {package_name}: "
                    f"requested {package_ref.version}, "
                    f"but {existing_node.resolved_version} already resolved"
                )
            
            return existing_node
        
        # Resolve package from registry
        package_path = self.package_resolver.resolve_package(package_ref.to_string())
        
        # Load package manifest
        manifest = self.package_resolver.get_package_manifest(package_path)
        
        # Create dependency node
        node = DependencyNode(
            package_ref=package_ref,
            resolved_version=manifest.get('version', package_ref.version),
            dependencies=manifest.get('dependencies', {}),
            dev_dependencies=manifest.get('devDependencies', {}) if include_dev else {},
            peer_dependencies=manifest.get('peerDependencies', {}) if include_peer else {},
            resolved_path=package_path,
            depth=depth,
            parent=parent
        )
        
        # Add to resolved packages
        self.resolved_packages[package_name] = node
        
        # Add to dependency graph
        self.graph.add_node(package_name, **node.__dict__)
        if parent:
            self.graph.add_edge(parent, package_name)
        
        # Resolve all dependencies
        all_deps = {}
        all_deps.update(node.dependencies)
        if include_dev:
            all_deps.update(node.dev_dependencies)
        if include_peer:
            all_deps.update(node.peer_dependencies)
        
        # Resolve each dependency
        for dep_name, dep_version in all_deps.items():
            # Add version constraint
            constraint = VersionConstraint.parse(dep_version)
            self.version_constraints[dep_name].append((constraint, package_name))
            
            # Create dependency reference
            dep_ref_str = f"{dep_name}@{dep_version}"
            dep_ref = PackageReference.parse(dep_ref_str)
            
            # Recursive resolution
            self._resolve_recursive(
                dep_ref,
                depth=depth + 1,
                parent=package_name,
                include_dev=False,  # Only include dev deps for root
                include_peer=include_peer
            )
        
        return node
    
    def _is_version_compatible(self, 
                               requested_ref: PackageReference,
                               existing_node: DependencyNode) -> bool:
        """Check if requested version is compatible with existing resolution."""
        package_name = requested_ref.to_string().split('@')[0]
        
        # Get all constraints for this package
        constraints = self.version_constraints.get(package_name, [])
        
        # Check if existing version satisfies all constraints
        for constraint, _ in constraints:
            if not constraint.matches(existing_node.resolved_version):
                return False
        
        # Check if requested version is compatible
        requested_constraint = VersionConstraint.parse(requested_ref.version)
        return requested_constraint.matches(existing_node.resolved_version)
    
    def generate_lock_file(self) -> Dict[str, Any]:
        """
        Generate a lock file for reproducible builds.
        
        Returns:
            Lock file data structure
        """
        lock_data = {
            'lockfileVersion': 2,
            'requires': True,
            'packages': {},
            'dependencies': {}
        }
        
        # Add each resolved package to lock file
        for package_name, node in self.resolved_packages.items():
            lock_entry = {
                'version': node.resolved_version,
                'resolved': node.package_ref.to_string(),
                'integrity': '',  # Would be calculated from package hash
                'dependencies': node.dependencies,
                'devDependencies': node.dev_dependencies,
                'peerDependencies': node.peer_dependencies,
                'depth': node.depth
            }
            
            lock_data['packages'][package_name] = lock_entry
            
            # Add to top-level dependencies if depth is 1
            if node.depth == 1:
                lock_data['dependencies'][package_name] = node.resolved_version
        
        return lock_data
    
    def install_all(self, 
                   target_dir: Path,
                   parallel: bool = True) -> Dict[str, Path]:
        """
        Install all resolved dependencies.
        
        Args:
            target_dir: Target directory for installation
            parallel: Enable parallel downloads
            
        Returns:
            Dict mapping package names to installed paths
        """
        installed = {}
        target_dir.mkdir(parents=True, exist_ok=True)
        
        if parallel and len(self.resolution_order) > 1:
            # Parallel installation
            with ThreadPoolExecutor(max_workers=self.parallel_downloads) as executor:
                futures = []
                for package_name in self.resolution_order:
                    node = self.resolved_packages[package_name]
                    future = executor.submit(
                        self._install_package,
                        node,
                        target_dir / package_name
                    )
                    futures.append((package_name, future))
                
                for package_name, future in futures:
                    installed[package_name] = future.result()
        else:
            # Sequential installation
            for package_name in self.resolution_order:
                node = self.resolved_packages[package_name]
                installed[package_name] = self._install_package(
                    node,
                    target_dir / package_name
                )
        
        return installed
    
    def _install_package(self, node: DependencyNode, target_path: Path) -> Path:
        """Install a single package."""
        if node.resolved_path:
            # Copy from cache to target location
            import shutil
            if target_path.exists():
                shutil.rmtree(target_path)
            shutil.copytree(node.resolved_path, target_path)
            return target_path
        else:
            # Download and install
            package_path = self.package_resolver.install_package(
                node.package_ref.to_string(),
                force_global=False
            )
            
            # Copy to target location
            import shutil
            if target_path.exists():
                shutil.rmtree(target_path)
            shutil.copytree(package_path, target_path)
            return target_path
    
    def get_dependency_tree(self) -> str:
        """
        Generate a visual representation of the dependency tree.
        
        Returns:
            String representation of the dependency tree
        """
        if not self.resolved_packages:
            return "No dependencies resolved"
        
        lines = []
        visited = set()
        
        # Find root packages (depth 0)
        roots = [node for node in self.resolved_packages.values() if node.depth == 0]
        
        for root in roots:
            self._build_tree_string(root, lines, visited, "")
        
        return "\n".join(lines)
    
    def _build_tree_string(self, 
                          node: DependencyNode, 
                          lines: List[str], 
                          visited: Set[str],
                          prefix: str):
        """Recursively build tree string representation."""
        if node.name in visited:
            lines.append(f"{prefix}├── {node.name}@{node.resolved_version} (circular)")
            return
        
        visited.add(node.name)
        lines.append(f"{prefix}├── {node.name}@{node.resolved_version}")
        
        # Get children
        children = []
        for dep_name in node.dependencies:
            if dep_name in self.resolved_packages:
                children.append(self.resolved_packages[dep_name])
        
        # Recursively add children
        for i, child in enumerate(children):
            is_last = i == len(children) - 1
            child_prefix = prefix + ("    " if is_last else "│   ")
            self._build_tree_string(child, lines, visited, child_prefix)
    
    def find_conflicts(self) -> List[Dict[str, Any]]:
        """
        Find all version conflicts in the dependency tree.
        
        Returns:
            List of conflict descriptions
        """
        conflicts = []
        
        for package_name, constraints in self.version_constraints.items():
            if len(constraints) <= 1:
                continue
            
            # Check if all constraints can be satisfied by a single version
            resolved_node = self.resolved_packages.get(package_name)
            if not resolved_node:
                continue
            
            unsatisfied = []
            for constraint, requester in constraints:
                if not constraint.matches(resolved_node.resolved_version):
                    unsatisfied.append({
                        'requester': requester,
                        'constraint': constraint.raw,
                        'resolved': resolved_node.resolved_version
                    })
            
            if unsatisfied:
                conflicts.append({
                    'package': package_name,
                    'resolved_version': resolved_node.resolved_version,
                    'conflicts': unsatisfied
                })
        
        return conflicts
    
    def optimize_duplicates(self) -> Dict[str, List[str]]:
        """
        Find and optimize duplicate packages with compatible versions.
        
        Returns:
            Dict mapping packages to list of compatible versions
        """
        duplicates = defaultdict(list)
        
        # Group packages by name
        package_versions = defaultdict(list)
        for node in self.resolved_packages.values():
            base_name = node.name.split('@')[0]
            package_versions[base_name].append(node.resolved_version)
        
        # Find packages with multiple versions
        for package_name, versions in package_versions.items():
            if len(versions) > 1:
                # Check if versions are compatible
                unique_versions = list(set(versions))
                if len(unique_versions) > 1:
                    duplicates[package_name] = unique_versions
        
        return dict(duplicates)