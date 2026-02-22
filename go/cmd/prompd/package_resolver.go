package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// PackageReference represents a parsed package reference
type PackageReference struct {
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
	Version   string `json:"version"`
}

// ParsePackageReference parses a package reference string
func ParsePackageReference(reference string) (*PackageReference, error) {
	if reference == "" {
		return nil, fmt.Errorf("empty package reference")
	}

	// Pattern: @namespace/name@version or name@version
	scopedPattern := regexp.MustCompile(`^@([^/]+)/([^@]+)(?:@(.+))?$`)
	unscopedPattern := regexp.MustCompile(`^([^@]+)(?:@(.+))?$`)

	// Try scoped pattern first
	if matches := scopedPattern.FindStringSubmatch(reference); matches != nil {
		version := matches[3]
		if version == "" {
			version = "latest"
		}
		return &PackageReference{
			Namespace: matches[1],
			Name:      matches[2],
			Version:   version,
		}, nil
	}

	// Try unscoped pattern
	if matches := unscopedPattern.FindStringSubmatch(reference); matches != nil {
		version := matches[2]
		if version == "" {
			version = "latest"
		}
		return &PackageReference{
			Name:    matches[1],
			Version: version,
		}, nil
	}

	return nil, fmt.Errorf("invalid package reference format: %s", reference)
}

// ToString converts package reference back to string
func (pr *PackageReference) ToString() string {
	if pr.Namespace != "" {
		return fmt.Sprintf("@%s/%s@%s", pr.Namespace, pr.Name, pr.Version)
	}
	return fmt.Sprintf("%s@%s", pr.Name, pr.Version)
}

// RegistryDiscoveryInfo represents registry discovery information
type RegistryDiscoveryInfo struct {
	Name         string                 `json:"name"`
	BaseURL      string                 `json:"base_url"`
	Endpoints    map[string]string      `json:"endpoints"`
	Capabilities map[string]interface{} `json:"capabilities"`
}

// LoadRegistryInfo discovers registry info from /.well-known/registry.json
func LoadRegistryInfo(baseURL string) (*RegistryDiscoveryInfo, error) {
	wellKnownURL := strings.TrimSuffix(baseURL, "/") + "/.well-known/registry.json"
	
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(wellKnownURL)
	if err != nil {
		return nil, fmt.Errorf("failed to discover registry at %s: %v", baseURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("registry discovery failed: %d", resp.StatusCode)
	}

	var info RegistryDiscoveryInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to parse registry info: %v", err)
	}

	info.BaseURL = baseURL
	return &info, nil
}

// PackageCache manages local package caching
type PackageCache struct {
	CacheDir string
}

// NewPackageCache creates a new package cache
func NewPackageCache() *PackageCache {
	var cacheDir string
	
	if runtime.GOOS == "windows" {
		cacheDir = filepath.Join(os.Getenv("LOCALAPPDATA"), "prompd", "cache")
	} else {
		homeDir, _ := os.UserHomeDir()
		cacheDir = filepath.Join(homeDir, ".cache", "prompd")
	}

	// Create cache directory
	os.MkdirAll(cacheDir, 0755)

	return &PackageCache{CacheDir: cacheDir}
}

// GetPackageDir returns the cache directory for a specific package version
func (pc *PackageCache) GetPackageDir(pkgRef *PackageReference) string {
	if pkgRef.Namespace != "" {
		return filepath.Join(pc.CacheDir, fmt.Sprintf("@%s", pkgRef.Namespace), pkgRef.Name, pkgRef.Version)
	}
	return filepath.Join(pc.CacheDir, pkgRef.Name, pkgRef.Version)
}

// IsCached checks if package is cached locally
func (pc *PackageCache) IsCached(pkgRef *PackageReference) bool {
	packageDir := pc.GetPackageDir(pkgRef)
	manifestFile := filepath.Join(packageDir, "manifest.json")
	
	if _, err := os.Stat(manifestFile); err == nil {
		return true
	}
	return false
}

// GetCachedPackage returns path to cached package directory
func (pc *PackageCache) GetCachedPackage(pkgRef *PackageReference) (string, error) {
	packageDir := pc.GetPackageDir(pkgRef)
	if !pc.IsCached(pkgRef) {
		return "", fmt.Errorf("package not cached: %s", pkgRef.ToString())
	}
	return packageDir, nil
}

// CachePackage caches a downloaded package
func (pc *PackageCache) CachePackage(pkgRef *PackageReference, packageData []byte) (string, error) {
	packageDir := pc.GetPackageDir(pkgRef)
	if err := os.MkdirAll(packageDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create package directory: %v", err)
	}

	// Create temporary file for the package
	tempFile, err := os.CreateTemp("", "package-*.pdpkg")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %v", err)
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	if _, err := tempFile.Write(packageData); err != nil {
		return "", fmt.Errorf("failed to write package data: %v", err)
	}
	tempFile.Close()

	// Extract package contents
	reader, err := zip.OpenReader(tempFile.Name())
	if err != nil {
		return "", fmt.Errorf("invalid package archive: %v", err)
	}
	defer reader.Close()

	for _, file := range reader.File {
		// Security check: prevent directory traversal
		if strings.Contains(file.Name, "..") || strings.HasPrefix(file.Name, "/") {
			continue
		}

		filePath := filepath.Join(packageDir, file.Name)
		if file.FileInfo().IsDir() {
			os.MkdirAll(filePath, 0755)
			continue
		}

		// Create file directory if needed
		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			return "", fmt.Errorf("failed to create directory: %v", err)
		}

		// Extract file
		rc, err := file.Open()
		if err != nil {
			return "", fmt.Errorf("failed to open archived file: %v", err)
		}

		outFile, err := os.Create(filePath)
		if err != nil {
			rc.Close()
			return "", fmt.Errorf("failed to create output file: %v", err)
		}

		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()

		if err != nil {
			return "", fmt.Errorf("failed to extract file: %v", err)
		}
	}

	return packageDir, nil
}

// ListCachedPackages returns all cached packages
func (pc *PackageCache) ListCachedPackages() ([]map[string]interface{}, error) {
	var packages []map[string]interface{}

	err := filepath.Walk(pc.CacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		if info.Name() == "manifest.json" {
			data, err := os.ReadFile(path)
			if err != nil {
				return nil // Skip errors
			}

			var manifest map[string]interface{}
			if err := json.Unmarshal(data, &manifest); err != nil {
				return nil // Skip errors
			}

			packages = append(packages, map[string]interface{}{
				"path":     filepath.Dir(path),
				"manifest": manifest,
			})
		}
		return nil
	})

	return packages, err
}

// Clear removes all cached packages
func (pc *PackageCache) Clear() error {
	return os.RemoveAll(pc.CacheDir)
}

// PackageResolver resolves and downloads packages from registries
type PackageResolver struct {
	RegistryURLs []string
	Registries   map[string]*RegistryDiscoveryInfo
	Cache        *PackageCache
	Verbose      bool
}

// NewPackageResolver creates a new package resolver
func NewPackageResolver() *PackageResolver {
	return &PackageResolver{
		RegistryURLs: []string{"https://registry.prompdhub.ai"},
		Registries:   make(map[string]*RegistryDiscoveryInfo),
		Cache:        NewPackageCache(),
	}
}

// DiscoverRegistries discovers all configured registries
func (pr *PackageResolver) DiscoverRegistries() {
	for _, url := range pr.RegistryURLs {
		if registry, err := LoadRegistryInfo(url); err == nil {
			pr.Registries[url] = registry
			if pr.Verbose {
				fmt.Printf("OK Discovered registry: %s (%s)\n", registry.Name, url)
			}
		} else if pr.Verbose {
			fmt.Printf("Warning: Failed to discover registry %s: %v\n", url, err)
		}
	}
}

// ResolvePackage resolves a package reference to a local path
func (pr *PackageResolver) ResolvePackage(packageReference string) (string, error) {
	pkgRef, err := ParsePackageReference(packageReference)
	if err != nil {
		return "", err
	}

	// Check cache first
	if pr.Cache.IsCached(pkgRef) {
		return pr.Cache.GetCachedPackage(pkgRef)
	}

	// Discover registries if not done
	if len(pr.Registries) == 0 {
		pr.DiscoverRegistries()
	}

	// Try to download from registries
	for registryURL, registry := range pr.Registries {
		if packageData, err := pr.downloadPackage(registryURL, registry, pkgRef); err == nil {
			return pr.Cache.CachePackage(pkgRef, packageData)
		} else if pr.Verbose {
			fmt.Printf("Warning: Failed to download from %s: %v\n", registryURL, err)
		}
	}

	return "", fmt.Errorf("package not found in any registry: %s", packageReference)
}

// downloadPackage downloads package from a specific registry
func (pr *PackageResolver) downloadPackage(registryURL string, registry *RegistryDiscoveryInfo, pkgRef *PackageReference) ([]byte, error) {
	// Build metadata URL
	var metadataEndpoint string
	if pkgRef.Namespace != "" {
		if endpoint, exists := registry.Endpoints["scopedPackage"]; exists {
			metadataEndpoint = strings.ReplaceAll(endpoint, "{scope}", pkgRef.Namespace)
			metadataEndpoint = strings.ReplaceAll(metadataEndpoint, "{package}", pkgRef.Name)
		} else {
			metadataEndpoint = fmt.Sprintf("/@%s/%s", pkgRef.Namespace, pkgRef.Name)
		}
	} else {
		if endpoint, exists := registry.Endpoints["package"]; exists {
			metadataEndpoint = strings.ReplaceAll(endpoint, "{package}", pkgRef.Name)
		} else {
			metadataEndpoint = fmt.Sprintf("/%s", pkgRef.Name)
		}
	}

	metadataURL := strings.TrimSuffix(registryURL, "/") + "/" + strings.TrimPrefix(metadataEndpoint, "/")

	// Get package metadata
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(metadataURL)
	if err != nil {
		return nil, fmt.Errorf("failed to get metadata: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("metadata request failed: %d", resp.StatusCode)
	}

	var metadata map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&metadata); err != nil {
		return nil, fmt.Errorf("failed to parse metadata: %v", err)
	}

	// Get version-specific info
	versions, ok := metadata["versions"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("no versions found")
	}

	var version string
	if pkgRef.Version == "latest" {
		// Use dist-tags to find latest version
		if distTags, ok := metadata["dist-tags"].(map[string]interface{}); ok {
			if latest, ok := distTags["latest"].(string); ok {
				version = latest
			}
		}
		// Fallback: use highest version (simple string comparison)
		if version == "" {
			for v := range versions {
				if version == "" || v > version {
					version = v
				}
			}
		}
	} else {
		version = pkgRef.Version
	}

	versionInfo, ok := versions[version].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("version %s not found", version)
	}

	// Get download URL
	var downloadURL string
	if dist, ok := versionInfo["dist"].(map[string]interface{}); ok {
		if tarball, ok := dist["tarball"].(string); ok {
			downloadURL = tarball
		}
	}

	if downloadURL == "" {
		// Construct download URL from template
		downloadEndpoint := registry.Endpoints["download"]
		if downloadEndpoint == "" {
			downloadEndpoint = "/{package}/-/{package}-{version}.pdpkg"
		}
		downloadEndpoint = strings.ReplaceAll(downloadEndpoint, "{package}", pkgRef.Name)
		downloadEndpoint = strings.ReplaceAll(downloadEndpoint, "{version}", version)
		downloadURL = strings.TrimSuffix(registryURL, "/") + "/" + strings.TrimPrefix(downloadEndpoint, "/")
	}

	// Download the package
	downloadResp, err := client.Get(downloadURL)
	if err != nil {
		return nil, fmt.Errorf("failed to download package: %v", err)
	}
	defer downloadResp.Body.Close()

	if downloadResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed: %d", downloadResp.StatusCode)
	}

	return io.ReadAll(downloadResp.Body)
}

// GetPackageManifest loads package manifest.json
func (pr *PackageResolver) GetPackageManifest(packagePath string) (map[string]interface{}, error) {
	manifestFile := filepath.Join(packagePath, "manifest.json")
	data, err := os.ReadFile(manifestFile)
	if err != nil {
		return nil, fmt.Errorf("package manifest not found: %v", err)
	}

	var manifest map[string]interface{}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("invalid package manifest: %v", err)
	}

	return manifest, nil
}

// Global package resolver instance
var globalPackageResolver = NewPackageResolver()