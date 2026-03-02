package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// PackageManifest represents the manifest.json structure in a .pdpkg file
type PackageManifest struct {
	Name        string                 `json:"name"`
	Version     string                 `json:"version"`
	Description string                 `json:"description"`
	Author      string                 `json:"author,omitempty"`
	Type        string                 `json:"type"`
	Files       map[string]interface{} `json:"files,omitempty"`
}

// PDProjMetadata represents the structure of a .pdproj file
type PDProjMetadata struct {
	Name        string                 `yaml:"name"`
	Version     string                 `yaml:"version"`
	Description string                 `yaml:"description"`
	Author      string                 `yaml:"author,omitempty"`
	Settings    map[string]interface{} `yaml:"settings,omitempty"`
	Exclusions  PDProjExclusions       `yaml:"exclusions,omitempty"`
}

type PDProjExclusions struct {
	Directories []string `yaml:"directories,omitempty"`
	Patterns    []string `yaml:"patterns,omitempty"`
}

func handlePackage() {
	if len(os.Args) < 3 {
		printPackageUsage()
		return
	}

	switch os.Args[2] {
	case "create":
		handlePackageCreate()
	case "validate":
		handlePackageValidate()
	default:
		// Legacy behavior - treat first arg as source if it looks like a file/directory
		if strings.HasSuffix(os.Args[2], ".pdproj") || !strings.HasPrefix(os.Args[2], "--") {
			// Shift arguments to maintain compatibility
			handlePackageCreateLegacy(os.Args[2:])
		} else {
			fmt.Printf("Unknown package subcommand: %s\n", os.Args[2])
			printPackageUsage()
			os.Exit(1)
		}
	}
}

func printPackageUsage() {
	fmt.Println(`Package Commands:
  prompd package create <source>       Create a .pdpkg from .pdproj file or directory
  prompd package validate <file>       Validate a .prmd or .pdpkg package
  
Examples:
  prompd package create project.pdproj
  prompd package create directory --name NAME --version VERSION --description DESC
  prompd package validate example.pdpkg`)
}

func handlePackageCreate() {
	if len(os.Args) < 4 {
		fmt.Println("Error: package create requires a source path (.pdproj file or directory)")
		fmt.Println("Usage:")
		fmt.Println("  prompd package create project.pdproj")
		fmt.Println("  prompd package create directory --name NAME --version VERSION --description DESC [--author AUTHOR]")
		os.Exit(1)
	}

	source := os.Args[3]
	
	// Check if source is a .pdproj file
	if strings.HasSuffix(source, ".pdproj") {
		if err := packageFromPdproj(source); err != nil {
			fmt.Printf("Error creating package from .pdproj: %v\n", err)
			os.Exit(1)
		}
	} else {
		// Directory mode - requires manual parameters
		if err := packageFromDirectory(source, os.Args[4:]); err != nil {
			fmt.Printf("Error creating package from directory: %v\n", err)
			os.Exit(1)
		}
	}
}

func handlePackageCreateLegacy(args []string) {
	source := args[0]
	
	// Check if source is a .pdproj file
	if strings.HasSuffix(source, ".pdproj") {
		if err := packageFromPdproj(source); err != nil {
			fmt.Printf("Error creating package from .pdproj: %v\n", err)
			os.Exit(1)
		}
	} else {
		// Directory mode - requires manual parameters
		if err := packageFromDirectory(source, args[1:]); err != nil {
			fmt.Printf("Error creating package from directory: %v\n", err)
			os.Exit(1)
		}
	}
}

func handlePackageValidate() {
	if len(os.Args) < 4 {
		fmt.Println("Error: package validate requires a .pdpkg file path")
		fmt.Println("Usage: prompd package validate <file.pdpkg>")
		os.Exit(1)
	}

	filePath := os.Args[3]
	
	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		fmt.Printf("Error: File does not exist: %s\n", filePath)
		os.Exit(1)
	}

	// Only accept .pdpkg files - packages are archives, not individual .prmd files
	if !strings.HasSuffix(filePath, ".pdpkg") {
		fmt.Printf("❌ Invalid package format!\n")
		fmt.Printf("   File: %s\n", filepath.Base(filePath))
		fmt.Printf("   Expected: .pdpkg archive file\n")
		fmt.Printf("   Note: .prmd files are individual prompts, not packages\n")
		fmt.Printf("   Use 'prompd validate' to validate individual .prmd files\n")
		os.Exit(1)
	}

	// Validate .pdpkg file structure
	if err := validatePdpkgFile(filePath); err != nil {
		fmt.Printf("❌ Package validation failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ Package validation passed: %s\n", filepath.Base(filePath))
}

func packageFromPdproj(pdprojPath string) error {
	// Read and parse .pdproj file
	data, err := os.ReadFile(pdprojPath)
	if err != nil {
		return fmt.Errorf("failed to read .pdproj file: %v", err)
	}

	var metadata PDProjMetadata
	if err := yaml.Unmarshal(data, &metadata); err != nil {
		return fmt.Errorf("failed to parse .pdproj file: %v", err)
	}

	// SECURITY: Validate package metadata
	if err := validatePackageName(metadata.Name); err != nil {
		return fmt.Errorf("invalid package name: %v", err)
	}

	if err := validateVersion(metadata.Version); err != nil {
		return fmt.Errorf("invalid version: %v", err)
	}

	if err := validateDescription(metadata.Description); err != nil {
		return fmt.Errorf("invalid description: %v", err)
	}

	if metadata.Author != "" {
		if err := validateAuthor(metadata.Author); err != nil {
			return fmt.Errorf("invalid author: %v", err)
		}
	}

	// Source directory is parent of .pdproj file
	sourceDir := filepath.Dir(pdprojPath)

	// SECURITY: Two-pass scanning for secrets
	fmt.Println("🔒 Scanning for secrets...")

	excludePatterns := []string{
		"*.pdproj",
		".git",
		"node_modules",
		"__pycache__",
		"*.pyc",
		"dist",
		"build",
		".DS_Store",
	}

	// Add custom exclusions from .pdproj
	excludePatterns = append(excludePatterns, metadata.Exclusions.Patterns...)

	secrets, err := scanDirectoryForSecrets(sourceDir, excludePatterns)
	if err != nil {
		return fmt.Errorf("error scanning for secrets: %v", err)
	}

	if len(secrets) > 0 {
		fmt.Println()
		fmt.Println("⚠️  SECURITY WARNING: Potential secrets detected!")
		fmt.Println("The following files contain sensitive data:")
		fmt.Println()

		for _, secret := range secrets {
			relPath, _ := filepath.Rel(sourceDir, secret.FilePath)
			fmt.Printf("  • %s:%d - %s\n", relPath, secret.Line, secret.Type)
			fmt.Printf("    Preview: %s\n\n", secret.MaskedValue)
		}

		fmt.Println("❌ Package creation blocked to prevent credential leakage.")
		fmt.Println("Please remove secrets before packaging or add files to exclusions in .pdproj.")
		return fmt.Errorf("secrets detected in package contents")
	}

	fmt.Println("✓ No secrets detected")
	fmt.Println()

	// Generate output path with safe filename
	outputName := strings.ToLower(metadata.Name)
	outputName = strings.ReplaceAll(outputName, " ", "-")
	outputName = strings.ReplaceAll(outputName, "/", "-")
	outputName = strings.ReplaceAll(outputName, "@", "")
	outputPath := filepath.Join(sourceDir, fmt.Sprintf("%s-v%s.pdpkg", outputName, metadata.Version))

	// Create manifest
	manifest := PackageManifest{
		Name:        metadata.Name,
		Version:     metadata.Version,
		Description: metadata.Description,
		Author:      metadata.Author,
		Type:        "package",
	}

	// Create package
	if err := createPackage(sourceDir, outputPath, manifest, metadata.Exclusions); err != nil {
		return fmt.Errorf("failed to create package: %v", err)
	}

	fmt.Printf("✓ Package created successfully!\n")
	fmt.Printf("   Package: %s\n", outputPath)
	
	// Get file size
	if stat, err := os.Stat(outputPath); err == nil {
		fmt.Printf("   Size: %.1f KB\n", float64(stat.Size())/1024)
	}

	return nil
}

func packageFromDirectory(sourceDir string, args []string) error {
	// Parse arguments for directory mode
	var outputPath, name, version, description, author string
	
	if len(args) == 0 {
		return fmt.Errorf("directory packaging requires --name, --version, and --description flags")
	}

	// Simple argument parsing
	for i, arg := range args {
		switch arg {
		case "--name":
			if i+1 < len(args) {
				name = args[i+1]
			}
		case "--version":
			if i+1 < len(args) {
				version = args[i+1]
			}
		case "--description":
			if i+1 < len(args) {
				description = args[i+1]
			}
		case "--author":
			if i+1 < len(args) {
				author = args[i+1]
			}
		case "--output", "-o":
			if i+1 < len(args) {
				outputPath = args[i+1]
			}
		default:
			// Skip non-flag arguments (they're values for the flags)
			continue
		}
	}

	if name == "" || version == "" || description == "" {
		return fmt.Errorf("--name, --version, and --description are required for directory packaging")
	}

	// SECURITY: Validate package metadata
	if err := validatePackageName(name); err != nil {
		return fmt.Errorf("invalid package name: %v", err)
	}

	if err := validateVersion(version); err != nil {
		return fmt.Errorf("invalid version: %v", err)
	}

	if err := validateDescription(description); err != nil {
		return fmt.Errorf("invalid description: %v", err)
	}

	if author != "" {
		if err := validateAuthor(author); err != nil {
			return fmt.Errorf("invalid author: %v", err)
		}
	}

	// SECURITY: Scan for secrets before packaging
	fmt.Println("🔒 Scanning for secrets...")

	excludePatterns := []string{
		"*.pdproj",
		".git",
		"node_modules",
		"__pycache__",
		"*.pyc",
		"dist",
		"build",
		".DS_Store",
		"*.log",
		"*.tmp",
		"*.cache",
		".env*",
	}

	secrets, err := scanDirectoryForSecrets(sourceDir, excludePatterns)
	if err != nil {
		return fmt.Errorf("error scanning for secrets: %v", err)
	}

	if len(secrets) > 0 {
		fmt.Println()
		fmt.Println("⚠️  SECURITY WARNING: Potential secrets detected!")
		fmt.Println("The following files contain sensitive data:")
		fmt.Println()

		for _, secret := range secrets {
			relPath, _ := filepath.Rel(sourceDir, secret.FilePath)
			fmt.Printf("  • %s:%d - %s\n", relPath, secret.Line, secret.Type)
			fmt.Printf("    Preview: %s\n\n", secret.MaskedValue)
		}

		fmt.Println("❌ Package creation blocked to prevent credential leakage.")
		fmt.Println("Please remove secrets before packaging.")
		return fmt.Errorf("secrets detected in package contents")
	}

	fmt.Println("✓ No secrets detected")
	fmt.Println()

	if outputPath == "" {
		// Generate safe filename from package name
		safeName := strings.ToLower(name)
		safeName = strings.ReplaceAll(safeName, " ", "-")
		safeName = strings.ReplaceAll(safeName, "/", "-")
		safeName = strings.ReplaceAll(safeName, "@", "")
		outputPath = fmt.Sprintf("%s-v%s.pdpkg", safeName, version)
	}

	// Ensure .pdpkg extension
	if !strings.HasSuffix(outputPath, ".pdpkg") {
		outputPath += ".pdpkg"
	}

	manifest := PackageManifest{
		Name:        name,
		Version:     version,
		Description: description,
		Author:      author,
		Type:        "package",
	}

	// Create package with default exclusions
	exclusions := PDProjExclusions{
		Directories: []string{".git", ".prmd", "node_modules", "__pycache__"},
		Patterns:    []string{"*.log", "*.tmp", "*.cache", ".env*"},
	}

	if err := createPackage(sourceDir, outputPath, manifest, exclusions); err != nil {
		return fmt.Errorf("failed to create package: %v", err)
	}

	fmt.Printf("✓ Package created successfully!\n")
	fmt.Printf("   Package: %s\n", outputPath)
	
	if stat, err := os.Stat(outputPath); err == nil {
		fmt.Printf("   Size: %.1f KB\n", float64(stat.Size())/1024)
	}

	return nil
}

func createPackage(sourceDir, outputPath string, manifest PackageManifest, exclusions PDProjExclusions) error {
	// Create zip file
	zipFile, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	// Add manifest.json
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}

	manifestFile, err := zipWriter.Create("manifest.json")
	if err != nil {
		return err
	}
	if _, err := manifestFile.Write(manifestData); err != nil {
		return err
	}

	// SECURITY: Track total size to prevent oversized packages
	const maxTotalSize int64 = 200 * 1024 * 1024 // 200MB total package limit
	const maxFileSize int64 = 50 * 1024 * 1024    // 50MB per file limit
	var totalSize int64

	// Walk source directory and add files
	return filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// SECURITY: Reject symlinks to prevent including files from outside the package directory
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("security violation: symlinks not allowed in packages: %s", path)
		}

		// SECURITY: Double-check with Lstat to catch symlinks that Walk may follow
		lstatInfo, lstatErr := os.Lstat(path)
		if lstatErr == nil && lstatInfo.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("security violation: symlink detected: %s", path)
		}

		// Get relative path
		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}

		// Skip the source directory itself
		if relPath == "." {
			return nil
		}

		// SECURITY: Validate path is safe (no traversal, null bytes, etc.)
		if pathErr := isSecurePath(relPath, sourceDir); pathErr != nil {
			return fmt.Errorf("security violation in path %s: %v", relPath, pathErr)
		}

		// Check exclusions
		if shouldExclude(relPath, info, exclusions) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// Skip directories (they'll be created automatically)
		if info.IsDir() {
			return nil
		}

		// SECURITY: Enforce per-file size limit
		if info.Size() > maxFileSize {
			return fmt.Errorf("file too large: %s (%d bytes, max %d bytes)", relPath, info.Size(), maxFileSize)
		}

		// SECURITY: Enforce total package size limit
		totalSize += info.Size()
		if totalSize > maxTotalSize {
			return fmt.Errorf("total package size exceeds limit (%d bytes max)", maxTotalSize)
		}

		// Add file to zip
		zipPath := filepath.ToSlash(relPath) // Ensure forward slashes in zip

		zipFileWriter, err := zipWriter.Create(zipPath)
		if err != nil {
			return err
		}

		fileReader, err := os.Open(path)
		if err != nil {
			return err
		}
		defer fileReader.Close()

		// SECURITY: Use LimitReader to enforce file size limit during copy
		_, err = io.Copy(zipFileWriter, io.LimitReader(fileReader, maxFileSize+1))
		return err
	})
}

func shouldExclude(relPath string, info os.FileInfo, exclusions PDProjExclusions) bool {
	fileName := filepath.Base(relPath)
	
	// Always exclude .pdproj files - they're only for packaging metadata
	if strings.HasSuffix(fileName, ".pdproj") {
		return true
	}
	
	// Check directory exclusions
	if info.IsDir() {
		dirName := filepath.Base(relPath)
		for _, excl := range exclusions.Directories {
			if dirName == excl {
				return true
			}
		}
	}

	// Check pattern exclusions
	for _, pattern := range exclusions.Patterns {
		if matched, _ := filepath.Match(pattern, fileName); matched {
			return true
		}
	}

	return false
}


func validatePdpkgFile(filePath string) error {
	// SECURITY: Check package file size before opening
	stat, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("failed to stat file: %v", err)
	}
	const maxPackageSize int64 = 200 * 1024 * 1024 // 200MB
	if stat.Size() > maxPackageSize {
		return fmt.Errorf("package file too large: %d bytes (max %d bytes)", stat.Size(), maxPackageSize)
	}

	// Open ZIP file
	zipReader, err := zip.OpenReader(filePath)
	if err != nil {
		return fmt.Errorf("failed to open ZIP file: %v", err)
	}
	defer zipReader.Close()

	// SECURITY: Check for ZIP slip/directory traversal, symlinks, and decompression bombs
	const maxDecompressedSize uint64 = 500 * 1024 * 1024 // 500MB total decompressed limit
	const maxCompressionRatio uint64 = 100                // 100:1 max ratio
	const maxFileCount = 1000
	var totalDecompressedSize uint64

	if len(zipReader.File) > maxFileCount {
		return fmt.Errorf("too many files in package: %d (max %d)", len(zipReader.File), maxFileCount)
	}

	for _, file := range zipReader.File {
		// SECURITY: Check for null bytes in raw name before cleaning
		if strings.Contains(file.Name, "\x00") {
			return fmt.Errorf("security violation: null byte in file name: %s", file.Name)
		}

		// Normalize path and check for traversal
		cleanPath := filepath.Clean(file.Name)
		if strings.Contains(cleanPath, "..") || filepath.IsAbs(file.Name) || filepath.IsAbs(cleanPath) {
			return fmt.Errorf("security violation: path traversal detected in %s", file.Name)
		}

		// SECURITY: Check for backslash-based traversal on all platforms
		if strings.Contains(file.Name, "\\..") || strings.Contains(file.Name, "..\\") {
			return fmt.Errorf("security violation: path traversal detected in %s", file.Name)
		}

		// SECURITY: Detect symlinks in ZIP entries
		if file.FileInfo().Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("security violation: symlink detected in package: %s", file.Name)
		}

		// SECURITY: Track cumulative decompressed size for bomb detection
		totalDecompressedSize += file.UncompressedSize64
		if totalDecompressedSize > maxDecompressedSize {
			return fmt.Errorf("security violation: total decompressed size exceeds limit (%d bytes max)", maxDecompressedSize)
		}

		// SECURITY: Check individual file compression ratio
		if file.CompressedSize64 > 0 {
			ratio := file.UncompressedSize64 / file.CompressedSize64
			if ratio > maxCompressionRatio {
				return fmt.Errorf("security violation: suspicious compression ratio %d:1 in %s (max %d:1)", ratio, file.Name, maxCompressionRatio)
			}
		}
	}

	// Check for manifest.json
	var manifestFound bool
	for _, file := range zipReader.File {
		if file.Name == "manifest.json" {
			manifestFound = true

			// SECURITY: Enforce manifest size limit
			const maxManifestSize uint64 = 1024 * 1024 // 1MB
			if file.UncompressedSize64 > maxManifestSize {
				return fmt.Errorf("manifest.json too large: %d bytes (max %d bytes)", file.UncompressedSize64, maxManifestSize)
			}

			// Read and validate manifest
			reader, err := file.Open()
			if err != nil {
				return fmt.Errorf("failed to read manifest.json: %v", err)
			}
			defer reader.Close()

			// SECURITY: Use LimitReader to enforce size during read
			content, err := io.ReadAll(io.LimitReader(reader, int64(maxManifestSize)+1))
			if err != nil {
				return fmt.Errorf("failed to read manifest content: %v", err)
			}
			if uint64(len(content)) > maxManifestSize {
				return fmt.Errorf("manifest.json content exceeds size limit")
			}

			var manifest PackageManifest
			if err := json.Unmarshal(content, &manifest); err != nil {
				return fmt.Errorf("invalid manifest.json: %v", err)
			}

			// Validate required fields
			if manifest.Name == "" {
				return fmt.Errorf("missing 'name' in manifest.json")
			}
			if manifest.Version == "" {
				return fmt.Errorf("missing 'version' in manifest.json")
			}
			if manifest.Description == "" {
				return fmt.Errorf("missing 'description' in manifest.json")
			}

			// SECURITY: Validate manifest type field
			if manifest.Type != "" && manifest.Type != "package" {
				return fmt.Errorf("invalid manifest type: %s (expected 'package')", manifest.Type)
			}

			// SECURITY: Validate manifest field formats
			if err := validatePackageName(manifest.Name); err != nil {
				return fmt.Errorf("invalid package name in manifest: %v", err)
			}
			if err := validateVersion(manifest.Version); err != nil {
				return fmt.Errorf("invalid version in manifest: %v", err)
			}

			break
		}
	}

	if !manifestFound {
		return fmt.Errorf("missing manifest.json in package")
	}

	return nil
}